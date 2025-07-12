
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
    const textPerPage = data.text.split(/\f/); // Split by form feed per page

    const srcDoc = await PDFDocument.load(buffer);
    const font = await srcDoc.embedFont(StandardFonts.Helvetica);
    const outputDoc = await PDFDocument.create();

    const allPages = await srcDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    let labelPages = [], invoicePages = [];
    let sku = "default";
    let invoiceFound = false;

    for (let i = 0; i < allPages.length; i++) {
      const text = textPerPage[i] || "";

      if (text.includes("Tax Invoice")) {
        invoiceFound = true;
        invoicePages.push(allPages[i]);
      } else if (!invoiceFound) {
        labelPages.push({ page: allPages[i], index: i });
      } else {
        invoicePages.push(allPages[i]);
      }
    }

    for (let { page, index } of labelPages) {
      const newPage = outputDoc.addPage([page.getWidth(), page.getHeight()]);
      newPage.drawPage(page);
      const labelText = textPerPage[index];
      const match = labelText.match(/SKU ID\s*\|\s*Description.*?(\w+)/);
      if (match) sku = match[1];

      newPage.drawText(`SKU: ${sku}`, {
        x: 40,
        y: 30,
        size: 12,
        font: font,
        color: rgb(0, 0, 0)
      });
    }

    for (let page of invoicePages) {
      const newPage = outputDoc.addPage([page.getWidth(), page.getHeight()]);
      newPage.drawPage(page);
    }

    const pdfBytes = await outputDoc.save();
    const fileName = `flipkart_cropped_sku_output_${uuidv4()}.pdf`;
    const filePath = path.join(__dirname, 'public', fileName);
    fs.writeFileSync(filePath, pdfBytes);
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
