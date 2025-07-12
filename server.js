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
      const { width, height } = page.getSize();

      // Output size: 216 x 355 pt (≈ 76mm x 125mm)
      const outputWidth = 216;
      const outputHeight = 355;

      const outputPage = newDoc.addPage([outputWidth, outputHeight]);

      const scale = Math.min(outputWidth / width, outputHeight / height);
      const xOffset = (outputWidth - width * scale) / 2;
      const yOffset = (outputHeight - height * scale) / 2;

      outputPage.drawPage(embeddedPage, {
        x: xOffset,
        y: yOffset,
        width: width * scale,
        height: height * scale
      });
    }

    const outputPdf = await newDoc.save();
    const fileName = `flipkart_final_${uuidv4()}.pdf`;
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
