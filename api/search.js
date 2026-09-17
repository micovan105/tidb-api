import mysql from 'mysql2/promise';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query.q || '';
  if (!query.trim()) return res.status(200).json({ web: [], images: [], time: 0 });

  const startTime = Date.now();
  let connection;

  try {
    connection = await mysql.createConnection({
      host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
      port: 4000,
      user: '2c6edPqWZTGt5z9.root',
      password: 'x3zLvX0icjBCJgFU',
      database: 'zozi',
      ssl: { rejectUnauthorized: true }
    });

    const cleanQuery = query.trim().toLowerCase();
    
    // Tách tập hợp từ khóa (lọc bỏ các từ quá ngắn, giữ tối đa 10 từ)
    const words = cleanQuery
      .replace(/[^\w\sàáạảãâấầẩẫậăắằẳẵặèéẹẻẽêếềểễệìíịỉĩòóọỏõôốồổỗộơớờởỡợùúụủũưứừửữựỳýỵỷỹđ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .slice(0, 10);

    let webList = [];

    if (words.length > 0) {
      const placeholders = words.map(() => '?').join(',');
      
      // Truy vấn mục lục ngược với tập hợp từ
      const sql1 = `
        SELECT m.doc_id, COUNT(DISTINCT t.word_id) as match_count
        FROM tu_dien t
        JOIN muc_luc_nguoc m ON t.word_id = m.word_id
        WHERE t.tu IN (${placeholders})
        GROUP BY m.doc_id
        ORDER BY match_count DESC
        LIMIT 300
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
          const previewLower = (doc.preview || '').toLowerCase();

          const matchedWordsCount = matchScores[docId] || 1;
          
          // Công thức tính điểm thông minh: Ưu tiên số lượng từ khớp trong tập hợp (nhân hệ số lớn)
          let score = matchedWordsCount * 200; 

          // Thưởng điểm nếu chứa trọn vẹn cả cụm từ khóa gốc
          if (titleLower.includes(cleanQuery)) score += 1000;
          if (previewLower.includes(cleanQuery)) score += 400;

          // Thưởng điểm cho từng từ xuất hiện rời rạc trong tiêu đề
          words.forEach(w => {
            if (titleLower.includes(w)) score += 80;
          });

          return {
            id: docId,
            title: title,
            url: doc.url || '#',
            snippet: doc.preview || 'Không có mô tả xem trước.',
            score: score,
            matchedWords: matchedWordsCount
          };
        });

        // Sắp xếp ưu tiên độ phủ từ trong tập hợp và điểm số cao nhất
        webList.sort((a, b) => {
          if (b.matchedWords !== a.matchedWords) {
            return b.matchedWords - a.matchedWords;
          }
          return b.score - a.score;
        });
      }
    }

    // FALLBACK: Nếu mục lục ngược không khớp, quét LIKE trực tiếp
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

    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

    return res.status(200).json({
      web: webList.slice(0, 30),
      images: [],
      time: executionTime
    });

  } catch (err) {
    return res.status(500).json({ error: 'Lỗi Database: ' + err.message });
  } finally {
    if (connection) await connection.end();
  }
}
