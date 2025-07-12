const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: 'Uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

app.post('/split-label-invoice', upload.single('label'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const buffer = await fs.readFile(req.file.path);
    const srcDoc = await PDFDocument.load(buffer);
    const totalPages = srcDoc.getPageCount();
    const newDoc = await PDFDocument.create();

    for (let i = 0; i < totalPages; i++) {
      const page = srcDoc.getPage(i);
      const embeddedPage = await newDoc.embedPage(page);

      // === CROPPING BASED ON STANDARD FLIPKART FORMAT (A4: 595x842) ===
      // LABEL AREA: from Y = 842 - 10 (top margin) - 470 (label height)
      const labelPage = newDoc.addPage([283, 470]);
      labelPage.drawPage(embeddedPage, {
        x: -155, // crop from left to center thermal format
        y: -(842 - 10 - 470),
        width: 595,
        height: 842
      });

      // INVOICE AREA: from Y = 842 - 490 (bottom area start)
      const invoicePage = newDoc.addPage([283, 330]);
      invoicePage.drawPage(embeddedPage, {
        x: -155,
        y: -490,
        width: 595,
        height: 842
      });
    }

    const outputPdf = await newDoc.save();
    const fileName = `flipkart_exact_${uuidv4()}.pdf`;
    const outputPath = path.join(__dirname, 'public', fileName);
    await fs.writeFile(outputPath, outputPdf);
    await fs.unlink(req.file.path).catch(() => {});

    res.json({ status: 'success', download: `/${fileName}` });
  } catch (err) {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
