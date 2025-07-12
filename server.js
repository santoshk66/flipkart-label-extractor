const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });
let productSkuMap = {};
const DEFAULT_SKU = "DEFAULT-SKU";

app.post('/upload-mapping', upload.single('file'), (req, res) => {
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (row) => {
      productSkuMap[row['Product Name'].toLowerCase()] = row['SKU'];
    })
    .on('end', () => {
      fs.unlinkSync(req.file.path);
      res.json({ status: 'Mapping uploaded successfully' });
    });
});

app.post('/process-label', upload.single('label'), async (req, res) => {
  const buffer = fs.readFileSync(req.file.path);
  const parsed = await pdfParse(buffer);
  const pdfDoc = await PDFDocument.load(buffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const productNames = extractProductNames(parsed.text);
  productNames.forEach((product, index) => {
    const matchedSku = matchToSku(product);
    const page = pages[index] || pages[0];
    page.drawText(`SKU: ${matchedSku}`, {
      x: 50,
      y: 25,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
  });

  const pdfBytes = await pdfDoc.save();
  res.setHeader('Content-Disposition', 'attachment; filename=label_with_sku.pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from(pdfBytes));
  fs.unlinkSync(req.file.path);
});

function extractProductNames(text) {
  const lines = text.split('\n');
  const productNames = [];
  lines.forEach(line => {
    if (line.toLowerCase().includes("maizic smarthome")) {
      productNames.push(line.trim());
    }
  });
  return productNames.length ? productNames : ["UNKNOWN PRODUCT"];
}

function matchToSku(productLine) {
  if (Object.keys(productSkuMap).length === 0) {
    return DEFAULT_SKU;
  }

  const keys = Object.keys(productSkuMap);
  for (let key of keys) {
    if (productLine.toLowerCase().includes(key)) {
      return productSkuMap[key];
    }
  }
  return DEFAULT_SKU;
}


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
