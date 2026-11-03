/**
 * Generador mínimo de archivos .xlsx (Excel) sin dependencias: un zip con XML.
 * Cada hoja: { nombre, columnas: [{ titulo, ancho, tipo }], filas: [[...]] }
 * tipo: 'texto' (por defecto), 'entero', 'decimal', 'dinero', 'fecha', 'fechahora'.
 * Las fechas se escriben como "AAAA-MM-DD" o "AAAA-MM-DDTHH:MM:SS" y quedan como fechas reales de Excel.
 */
const zlib = require('node:zlib');

const ESTILO = { texto: 0, encabezado: 1, entero: 2, decimal: 3, fecha: 4, fechahora: 5, dinero: 2 };

const limpiarXml = s => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnaLetra(i) {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Fecha ISO -> número de serie de Excel (días desde 1899-12-30; la hora va en la fracción) */
function serie(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(iso));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return ms / 86400000 + 25569;
}

function celda(valor, tipo, ref) {
  if (valor === null || valor === undefined || valor === '') return '';
  if ((tipo === 'fecha' || tipo === 'fechahora')) {
    const n = serie(valor);
    if (n !== null) return `<c r="${ref}" s="${ESTILO[tipo]}"><v>${n}</v></c>`;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}" s="${ESTILO[tipo] ?? 0}"><v>${valor}</v></c>`;
  if (typeof valor === 'boolean') return `<c r="${ref}" t="b"><v>${valor ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${limpiarXml(valor)}</t></is></c>`;
}

function hojaXml({ columnas, filas }) {
  const ncol = columnas.length, nfil = filas.length + 1;
  const cols = columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 16}" customWidth="1"/>`).join('');
  const enc = columnas.map((c, i) => `<c r="${columnaLetra(i)}1" s="${ESTILO.encabezado}" t="inlineStr"><is><t>${limpiarXml(c.titulo)}</t></is></c>`).join('');
  const cuerpo = filas.map((f, r) => `<row r="${r + 2}">${columnas.map((c, i) => celda(f[i], c.tipo, `${columnaLetra(i)}${r + 2}`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1">${enc}</row>${cuerpo}</sheetData><autoFilter ref="A1:${columnaLetra(ncol - 1)}${nfil}"/></worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6B1F2E"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ---------- zip ---------- */
function zip(archivos) {
  const partes = [], central = [];
  let offset = 0;
  const hora = new Date(), dosHora = (hora.getHours() << 11) | (hora.getMinutes() << 5) | (hora.getSeconds() >> 1);
  const dosFecha = ((hora.getFullYear() - 1980) << 9) | ((hora.getMonth() + 1) << 5) | hora.getDate();
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.from(contenido, 'utf8'), comp = zlib.deflateRawSync(datos), crc = zlib.crc32(datos), n = Buffer.from(nombre);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(8, 8);
    loc.writeUInt16LE(dosHora, 10); loc.writeUInt16LE(dosFecha, 12); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosHora, 12); cen.writeUInt16LE(dosFecha, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    partes.push(loc, n, comp); central.push(cen, n);
    offset += loc.length + n.length + comp.length;
  }
  const dirCentral = Buffer.concat(central), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(central.length / 2, 8); fin.writeUInt16LE(central.length / 2, 10);
  fin.writeUInt32LE(dirCentral.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, dirCentral, fin]);
}

function construirXlsx(hojas) {
  if (!hojas.length) throw new Error('El libro necesita al menos una hoja');
  const nombres = hojas.map((h, i) => limpiarXml(String(h.nombre || `Hoja${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31)));
  const archivos = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': ESTILOS,
  };
  hojas.forEach((h, i) => { archivos[`xl/worksheets/sheet${i + 1}.xml`] = hojaXml(h); });
  return zip(archivos);
}

module.exports = { construirXlsx, serie };
