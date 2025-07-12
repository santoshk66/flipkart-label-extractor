
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
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
    const buffer = await fs.readFile(req.file.path);
    const srcDoc = await PDFDocument.load(buffer);
    const fontDoc = await srcDoc.embedFont(StandardFonts.Helvetica);
    const outputDoc = await PDFDocument.create();

    const totalPages = srcDoc.getPageCount();
    const keyword = "Tax Invoice";
    let currentLabelPages = [];
    let currentInvoicePages = [];
    let sku = "default";

    const extractText = async (page) => {
      const textContent = await page.getTextContent();
      return textContent.items.map(item => item.str).join(" ");
    };

    const pageTexts = await Promise.all(srcDoc.getPages().map(p => p.getTextContent()));
    const pageTextStrings = pageTexts.map(tc => tc.items.map(i => i.str).join(" "));

    for (let i = 0; i < totalPages; i++) {
      const page = srcDoc.getPage(i);
      const text = pageTextStrings[i];

      if (text.includes(keyword)) {
        currentInvoicePages.push(i);
      } else if (currentInvoicePages.length === 0) {
        currentLabelPages.push(i);
      } else {
        currentInvoicePages.push(i);
      }
    }

    const allPages = await srcDoc.copyPages(srcDoc, [...currentLabelPages, ...currentInvoicePages]);
    const labelPages = allPages.slice(0, currentLabelPages.length);
    const invoicePages = allPages.slice(currentLabelPages.length);

    for (let lp of labelPages) {
      const newPage = outputDoc.addPage([lp.getWidth(), lp.getHeight()]);
      newPage.drawPage(lp);

      // Try extracting SKU from text
      const text = pageTextStrings[currentLabelPages[0]];
      const match = text.match(/SKU ID\s*\|\s*Description.*?(\w+)/);
      if (match) sku = match[1];

      newPage.drawText(`SKU: ${sku}`, {
        x: 40,
        y: 30,
        size: 12,
        font: fontDoc,
        color: rgb(0, 0, 0)
      });
    }

    for (let ip of invoicePages) {
      const newPage = outputDoc.addPage([ip.getWidth(), ip.getHeight()]);
      newPage.drawPage(ip);
    }

    const pdfBytes = await outputDoc.save();
    const fileName = `cropped_sku_labels_${uuidv4()}.pdf`;
    const filePath = path.join(__dirname, 'public', fileName);
    await fs.writeFile(filePath, pdfBytes);
    await fs.unlink(req.file.path).catch(() => {});

    res.json({ status: 'success', download: `/${fileName}` });
  } catch (err) {
    console.error(err);
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
