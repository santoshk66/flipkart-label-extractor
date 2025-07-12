
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: 'Uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
});

app.post('/process-labels', upload.single('label'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const buffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(buffer);
    const textPerPage = data.text.split(/\f/); // Form feed separation

    const srcDoc = await PDFDocument.load(buffer);
    const font = await srcDoc.embedFont(StandardFonts.Helvetica);
    const outputDoc = await PDFDocument.create();

    let invoiceFound = false;
    let sku = "default";

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const pageText = textPerPage[i] || "";
      const originalPage = srcDoc.getPage(i);
      const embedded = await outputDoc.embedPage(originalPage);
      const { width, height } = originalPage.getSize();

      if (pageText.includes("Tax Invoice")) {
        const invoicePage = outputDoc.addPage([width, height]);
        invoicePage.drawPage(embedded);
      } else if (!invoiceFound) {
        const labelPage = outputDoc.addPage([width, height]);
        labelPage.drawPage(embedded);

        const match = pageText.match(/SKU ID\s*\|\s*Description.*?(\w+)/);
        if (match) sku = match[1];

        labelPage.drawText(`SKU: ${sku}`, {
          x: 40,
          y: 30,
          size: 12,
          font: font,
          color: rgb(0, 0, 0)
        });
      }
    }

    const finalBytes = await outputDoc.save();
    const fileName = `flipkart_fixed_output_${uuidv4()}.pdf`;
    const filePath = path.join(__dirname, 'public', fileName);
    fs.writeFileSync(filePath, finalBytes);
    fs.unlinkSync(req.file.path);

    res.json({ status: 'success', download: `/${fileName}` });
  } catch (err) {
    console.error(err);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
