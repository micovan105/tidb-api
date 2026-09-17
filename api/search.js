import mysql from 'mysql2/promise';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const query = req.query.q || '';

  if (!query.trim()) {
    return res.status(200).json({ web: [], images: [], time: 0 });
  }

  const startTime = Date.now();
  let connection;

  try {
    // Kết nối TiDB Cloud cổng 4000
    connection = await mysql.createConnection({
      host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
      port: 4000,
      user: '2c6edPqWZTGt5z9.root',
      password: 'x3zLvX0icjBCJgFU',
      database: 'zozi',
      ssl: { rejectUnauthorized: true }
    });

    const cleanQuery = query.trim();
    
    // Tách từ khóa
    const words = cleanQuery.toLowerCase()
      .replace(/[^\w\sàáạảãâấầẩẫậăắằẳẵặèéẹẻẽêếềểễệìíịỉĩòóọỏõôốồổỗộơớờởỡợùúụủũưứừửữựỳýỵỷỹđ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .slice(0, 5);

    let webList = [];

    // --- CÁCH 1: TÌM QUA MỤC LỤC NGƯỢC ---
    if (words.length > 0) {
      const placeholders = words.map(() => '?').join(',');
      const sql1 = `
        SELECT m.doc_id, COUNT(*) as match_count
        FROM tu_dien t
        JOIN muc_luc_nguoc m ON t.word_id = m.word_id
        WHERE t.tu IN (${placeholders})
        GROUP BY m.doc_id
        ORDER BY match_count DESC
        LIMIT 100
      `;

      const [docMatches] = await connection.execute(sql1, words);

      if (docMatches && docMatches.length > 0) {
        const docIds = docMatches.map(row => row.doc_id);
        const matchScores = {};
        docMatches.forEach(row => { matchScores[row.doc_id] = row.match_count; });

        const docPlaceholders = docIds.map(() => '?').join(',');
        const sql2 = `SELECT doc_id, tieu_de, url, preview FROM kho_tai_lieu WHERE doc_id IN (${docPlaceholders})`;
        const [docs] = await connection.execute(sql2, docIds);

        webList = docs.map(doc => {
          const docId = doc.doc_id;
          const title = doc.tieu_de || `Tài liệu #${docId}`;
          const titleLower = title.toLowerCase();

          let score = (matchScores[docId] || 1) * 10;
          words.forEach(tu => {
            if (titleLower.includes(tu)) score += 50;
          });

          return {
            id: docId,
            title: title,
            url: doc.url || '#',
            snippet: doc.preview || 'Không có mô tả xem trước.',
            score: score
          };
        });

        webList.sort((a, b) => b.score - a.score);
      }
    }

    // --- CÁCH 2: FALLBACK TÌM THẲNG 'LIKE' TRONG KHO_TAI_LIEU NẾU MỤC LỤC NGƯỢC KHÔNG RA ---
    if (webList.length === 0) {
      const sqlFallback = `
        SELECT doc_id, tieu_de, url, preview 
        FROM kho_tai_lieu 
        WHERE tieu_de LIKE ? OR preview LIKE ? 
        LIMIT 30
      `;
      const searchPattern = `%${cleanQuery}%`;
      const [docsFallback] = await connection.execute(sqlFallback, [searchPattern, searchPattern]);

      webList = docsFallback.map(doc => ({
        id: doc.doc_id,
        title: doc.tieu_de || `Tài liệu #${doc.doc_id}`,
        url: doc.url || '#',
        snippet: doc.preview || 'Không có mô tả xem trước.',
        score: 100
      }));
    }

    await connection.end();
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

    return res.status(200).json({
      web: webList.slice(0, 30),
      images: [],
      time: executionTime
    });

  } catch (err) {
    if (connection) await connection.end();
    return res.status(500).json({ error: 'Lỗi Database: ' + err.message });
  }
}
