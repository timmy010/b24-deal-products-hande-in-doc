require('dotenv').config();

const express = require('express');
const axios = require('axios');
const PizZip = require('pizzip');

const app = express();

app.use(express.json({ limit: '50mb' }));

const B24_WEBHOOK_URL = process.env.B24_WEBHOOK_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const DEAL_FILE_SOURCE = process.env.DEAL_FILE_SOURCE;
const DEAL_FILE_TARGET = process.env.DEAL_FILE_TARGET;
const PORT = process.env.PORT || 3000;

const b24Api = axios.create({
  baseURL: B24_WEBHOOK_URL,
});

function extractFileId(data) {
  if (Array.isArray(data) && data[0]) return data[0];
  if (data && typeof data === 'object' && data.id) return data.id;
  return null;
}

function extractResult(resp) {
  if (resp.data && typeof resp.data === 'object' && 'result' in resp.data) {
    return resp.data.result;
  }
  return resp.data;
}

function normalizeProducts(products) {
  return (products || []).map(p => ({
    productId: p.PRODUCT_ID,
    productName: p.PRODUCT_NAME || '',
    price: Number(p.PRICE) || 0,
    quantity: Number(p.QUANTITY) || 0,
    measureCode: p.MEASURE_CODE,
    measureName: p.MEASURE_NAME,
    taxRate: p.TAX_RATE,
    taxIncluded: p.TAX_INCLUDED,
    discountTypeId: p.DISCOUNT_TYPE_ID,
    discountRate: p.DISCOUNT_RATE,
    discountSum: p.DISCOUNT_SUM,
    sort: p.SORT,
    customized: p.CUSTOMIZED,
  }));
}

function processProducts(products) {
  return (products || []).map((p, index) => {
    const price = Number(p.price) || 0;
    const quantity = Number(p.quantity) || 0;
    const rawTaxRate = p.taxRate;
    const noTaxRate = rawTaxRate === null || rawTaxRate === undefined;
    const taxRate = noTaxRate ? 0 : Number(rawTaxRate);
    const taxIncluded = p.taxIncluded;
    const isTaxIncluded = taxIncluded === true || taxIncluded === 'Y';

    let vatPerUnit = 0;
    let vatDisplay;
    let vatColumn;

    if (noTaxRate) {
      vatDisplay = '\u0411\u0435\u0437 \u041D\u0414\u0421';
      vatColumn = '\u0411\u0435\u0437 \u041D\u0414\u0421';
    } else if (taxRate === 0) {
      vatDisplay = '0%';
      vatColumn = '0';
    } else {
      vatDisplay = taxRate + '%';
      if (isTaxIncluded) {
        vatPerUnit = Math.round((price * taxRate) / (100 + taxRate) * 100) / 100;
      } else {
        vatPerUnit = Math.round(price * taxRate / 100 * 100) / 100;
      }
      vatColumn = (Math.round(vatPerUnit * quantity * 100) / 100).toFixed(2);
    }

    const total = Math.round(price * quantity * 100) / 100;

    return {
      num: index + 1,
      productName: p.productName || '',
      quantity,
      price: price.toFixed(2),
      total: total.toFixed(2),
      vatDisplay,
      vatTotal: vatColumn,
    };
  });
}

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tableCell(text, width, opts = {}) {
  const { bold, align } = opts;
  const alignMap = { left: 'start', center: 'center', right: 'end' };
  const jc = alignMap[align] || 'start';
  return [
    '<w:tc>',
    '  <w:tcPr>',
    `    <w:tcW w:w="${width}" w:type="dxa"/>`,
    '    <w:vAlign w:val="center"/>',
    '  </w:tcPr>',
    `  <w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>`,
    `    <w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="20"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`,
    '  </w:p>',
    '</w:tc>',
  ].join('\n');
}

function generateProductsTable(products) {
  const cols = [
    { width: 700, header: '\u2116 \u043F/\u043F' },
    { width: 3500, header: '\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u0438 \u0430\u0441\u0441\u043E\u0440\u0442\u0438\u043C\u0435\u043D\u0442 \u0421\u0417\u0418, \u043F\u0435\u0440\u0435\u0447\u0435\u043D\u044C (\u0432\u0438\u0434) \u043F\u0440\u0430\u0432 \u0438 \u0443\u0441\u043B\u0443\u0433' },
    { width: 800, header: '\u041A\u043E\u043B-\u0432\u043E, (\u0448\u0442.)' },
    { width: 1200, header: '\u0426\u0435\u043D\u0430 (\u0440\u0443\u0431.)' },
    { width: 1200, header: '\u0412 \u0442.\u0447. \u041D\u0414\u0421 5%' },
    { width: 1500, header: '\u0426\u0435\u043D\u0430, \u0440\u0430\u0437\u043C\u0435\u0440 \u043B\u0438\u0446\u0435\u043D\u0437\u0438\u043E\u043D\u043D\u043E\u0433\u043E \u0432\u043E\u0437\u043D\u0430\u0433\u0440\u0430\u0436\u0434\u0435\u043D\u0438\u044F, (\u0440\u0443\u0431.)' },
  ];
  const totalWidth = cols.reduce((s, c) => s + c.width, 0);

  function headerCell(text, width) {
    return [
      '<w:tc>',
      '  <w:tcPr>',
      `    <w:tcW w:w="${width}" w:type="dxa"/>`,
      '    <w:vAlign w:val="center"/>',
      '  </w:tcPr>',
      `  <w:p><w:pPr><w:jc w:val="center"/></w:pPr>`,
      `    <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`,
      '  </w:p>',
      '</w:tc>',
    ].join('\n');
  }

  let table = [
    '<w:tbl>',
    '  <w:tblPr>',
    `    <w:tblW w:w="${totalWidth}" w:type="dxa"/>`,
    '    <w:jc w:val="center"/>',
    '    <w:tblBorders>',
    '      <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>',
    '      <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>',
    '      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>',
    '      <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>',
    '      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>',
    '      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>',
    '    </w:tblBorders>',
    '  </w:tblPr>',
    '  <w:tblGrid>',
    cols.map((c) => `    <w:gridCol w:w="${c.width}"/>`).join('\n'),
    '  </w:tblGrid>',
  ].join('\n');

  table += '\n' + [
    '  <w:tr>',
    cols.map((c) => '    ' + headerCell(c.header, c.width)).join('\n'),
    '  </w:tr>',
  ].join('\n');

  products.forEach((p) => {
    table += '\n' + [
      '  <w:tr>',
      '    ' + tableCell(String(p.num), cols[0].width, { align: 'center' }),
      '    ' + tableCell(p.productName, cols[1].width),
      '    ' + tableCell(String(p.quantity), cols[2].width, { align: 'center' }),
      '    ' + tableCell(p.price, cols[3].width, { align: 'right' }),
      '    ' + tableCell(p.vatTotal, cols[4].width, { align: 'right' }),
      '    ' + tableCell(p.total, cols[5].width, { align: 'right' }),
      '  </w:tr>',
    ].join('\n');
  });

  table += '\n' + '</w:tbl>';
  return table;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.all('/inject-products', async (req, res) => {
  try {
    const { deal_id, token } = req.query;

    if (!deal_id || !token) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: deal_id, token',
      });
    }

    if (token !== AUTH_TOKEN) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }

    if (!DEAL_FILE_SOURCE || !DEAL_FILE_TARGET) {
      return res.status(500).json({ success: false, error: 'DEAL_FILE_SOURCE or DEAL_FILE_TARGET not configured' });
    }

    const dealResp = await b24Api.post('crm.deal.get', { id: deal_id });
    const dealInfo = extractResult(dealResp);

    const sourceFileData = dealInfo[DEAL_FILE_SOURCE];
    const sourceFileId = extractFileId(sourceFileData);
    if (!sourceFileId) {
      throw new Error(`Source field ${DEAL_FILE_SOURCE} is empty or missing on deal ${deal_id}`);
    }
    const downloadUrl = `${B24_WEBHOOK_URL}crm.controller.item.getFile?entityTypeId=2&id=${deal_id}&fieldName=${DEAL_FILE_SOURCE}&fileId=${sourceFileId}`;

    const docxResp = await axios.get(downloadUrl, { responseType: 'arraybuffer' });

    const productsResp = await b24Api.post('crm.deal.productrows.get', { id: deal_id });
    const productsRaw = extractResult(productsResp);
    const products = normalizeProducts(Array.isArray(productsRaw) ? productsRaw : []);
    const processedProducts = processProducts(products);

    const zip = new PizZip(docxResp.data);

    let documentXml;
    try {
      documentXml = zip.file('word/document.xml').asText();
    } catch {
      throw new Error('Invalid docx: missing word/document.xml');
    }

    const tableXml = generateProductsTable(processedProducts);

    const paraRegex = /<w:p\b[^>]*>[\s\S]*?products_table[\s\S]*?<\/w:p>/i;
    const paraMatch = documentXml.match(paraRegex);
    if (!paraMatch) {
      throw new Error('Placeholder products_table not found in document');
    }

    const fullPara = paraMatch[0];
    const cleanedPara = fullPara.replace(/(<w:t[^>]*>)products_table(<\/w:t>)/i, '$1$2');
    const updatedXml = documentXml.replace(fullPara, cleanedPara + '\n' + tableXml);
    zip.file('word/document.xml', updatedXml);

    const generated = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    const filename = `deal_${deal_id}_${Date.now()}.docx`;
    const content = generated.toString('base64');

    await b24Api.post('crm.deal.update', {
      id: deal_id,
      fields: {
        [DEAL_FILE_TARGET]: { fileData: [filename, content] },
      },
    });

    const updatedDealResp = await b24Api.post('crm.deal.get', { id: deal_id });
    const updatedDeal = extractResult(updatedDealResp);
    const savedFileData = updatedDeal[DEAL_FILE_TARGET];
    const savedFileId = extractFileId(savedFileData);
    if (savedFileId) {
      const fileUrl = `${B24_WEBHOOK_URL}crm.controller.item.getFile?entityTypeId=2&id=${deal_id}&fieldName=${DEAL_FILE_TARGET}&fileId=${savedFileId}`;
      await b24Api.post('crm.timeline.comment.add', {
        fields: {
          ENTITY_ID: Number(deal_id),
          ENTITY_TYPE: 'deal',
          COMMENT: '\u0421\u0444\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u043D \u0434\u043E\u0433\u043E\u0432\u043E\u0440: [url=' + fileUrl + ']\u0421\u041A\u0410\u0427\u0410\u0422\u042C[/url]',
        },
      });
    }

    return res.json({ success: true });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error_description || err.response?.data?.error || err.response?.data?.message || err.message;
    console.error(`[ERROR] ${status}: ${message}`);
    return res.status(status).json({ success: false, error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
