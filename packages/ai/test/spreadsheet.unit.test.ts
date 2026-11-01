import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkDebtFile } from "@organizeup/domain";
import { spreadsheetText } from "../src/debts/spreadsheet";

/** Planilha mínima de verdade: zip sem compressão, com as partes que um .xlsx precisa ter. */
function workbook(rows: string[][]): Uint8Array {
  const sheetRows = rows
    .map(
      (row, y) =>
        `<row r="${y + 1}">${row
          .map(
            (value, x) =>
              `<c r="${String.fromCharCode(65 + x)}${y + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relationships = "http://schemas.openxmlformats.org/package/2006/relationships";
  const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const parts: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="${main}" xmlns:r="${office}"><sheets><sheet name="Dívidas" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="${main}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, central, end]));
}

describe("planilha vira texto", () => {
  const file = workbook([
    ["Credor", "Saldo"],
    ["Loja Exemplo", "1000,00"],
  ]);

  it("passa pela conferência de tipo como xlsx", () => {
    expect(checkDebtFile(file, "dividas.xlsx").ok).toBe(true);
  });

  it("lê a primeira aba no servidor, uma linha por registro", async () => {
    expect(await spreadsheetText(file)).toBe("Credor\tSaldo\nLoja Exemplo\t1000,00");
  });
});
