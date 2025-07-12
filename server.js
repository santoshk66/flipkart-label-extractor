const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const { parse } = require('json2csv');

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
  const picklist = [];

  for (let i = 0; i < pages.length; i++) {
    const productName = productNames[i] || "UNKNOWN PRODUCT";
    const matchedSku = matchToSku(productName);
    picklist.push({
      "Order ID": `ORDER${1000 + i}`,
      "Product Name": productName,
      "SKU": matchedSku,
      "Buyer": `Customer ${i + 1}`,
      "Qty": 1
    });
    pages[i].drawText(`SKU: ${matchedSku}`, {
      x: 50,
      y: 25,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const finalPdf = await pdfDoc.save();
  const picklistCSV = parse(picklist);

  fs.writeFileSync("public/picklist.csv", picklistCSV);

  const mergedBuffer = Buffer.from(finalPdf);
  fs.writeFileSync("public/label_with_sku.pdf", mergedBuffer);

  // Crop simulated zones (static cropping)
  const croppedLabel = await cropRegion(pdfDoc, 0, { x: 0, y: 400, width: 600, height: 400 }); // label area
  const croppedInvoice = await cropRegion(pdfDoc, 0, { x: 0, y: 0, width: 600, height: 400 }); // invoice area

  fs.writeFileSync("public/label_only.pdf", croppedLabel);
  fs.writeFileSync("public/invoice_only.pdf", croppedInvoice);

  fs.unlinkSync(req.file.path);
  res.json({ status: "Processed", downloads: ["/label_with_sku.pdf", "/picklist.csv", "/label_only.pdf", "/invoice_only.pdf"] });
});

async function cropRegion(pdfDoc, pageIndex, region) {
  const [srcPdf] = await PDFDocument.create().copyPages(pdfDoc, [pageIndex]);
  const newDoc = await PDFDocument.create();
  const page = newDoc.addPage([region.width, region.height]);
  page.drawPage(srcPdf, {
    x: -region.x,
    y: -region.y
  });
  return await newDoc.save();
}

function extractProductNames(text) {
  const lines = text.split('\n');
  return lines.filter(line => line.toLowerCase().includes("maizic smarthome"));
}

function matchToSku(productLine) {
  if (Object.keys(productSkuMap).length === 0) return DEFAULT_SKU;
  for (let key of Object.keys(productSkuMap)) {
    if (productLine.toLowerCase().includes(key)) {
      return productSkuMap[key];
    }
  }
  return DEFAULT_SKU;
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
