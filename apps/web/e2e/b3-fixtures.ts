// Arquivos fictícios para o e2e da importação: Excel e PDF montados aqui, com dados inventados. Seguem o
// layout das fontes citadas em `packages/domain/src/b3-spreadsheet.ts` e `brokerage-note.ts`.
import { crc32 } from "node:zlib";
import { jsPDF, type jsPDFOptions } from "jspdf";

type Cell = string | number | null;

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const columnName = (index: number) => String.fromCharCode(65 + index);

function sheetXml(rows: Cell[][], strings: string[]) {
  const rowsXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, cellIndex) => {
          if (cell === null) return "";
          const ref = `${columnName(cellIndex)}${rowIndex + 1}`;
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          strings.push(cell);
          return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
}

/** Zip sem compressão: o leitor do navegador aceita, e o tipo do arquivo continua verdadeiro. */
function zip(files: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function workbook(name: string, sheets: Record<string, Cell[][]>) {
  const strings: string[] = [];
  const titles = Object.keys(sheets);
  const worksheets = titles.map((title, index): [string, string] => [
    `xl/worksheets/sheet${index + 1}.xml`,
    sheetXml(sheets[title]!, strings),
  ]);
  const shared = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
    .map((text) => `<si><t>${escapeXml(text)}</t></si>`)
    .join("")}</sst>`;
  const buffer = zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${titles
        .map(
          (_, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join(
          "",
        )}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${titles
        .map(
          (title, index) =>
            `<sheet name="${escapeXml(title)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
        )
        .join("")}</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${titles
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join(
          "",
        )}<Relationship Id="rId${titles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ],
    ["xl/sharedStrings.xml", shared],
    ...worksheets,
  ]);
  return {
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  };
}

const BROKER = "CORRETORA EXEMPLO S.A.";

export const negociacao = (name = "negociacao-2026-03.xlsx") =>
  workbook(name, {
    Negociação: [
      [
        "Data do Negócio",
        "Tipo de Movimentação",
        "Mercado",
        "Prazo/Vencimento",
        "Instituição",
        "Código de Negociação",
        "Quantidade",
        "Preço",
        "Valor",
      ],
      ["05/03/2026", "Compra", "Mercado à Vista", "-", BROKER, "ABCD3", 100, 10, 1000],
      ["05/03/2026", "Compra", "Mercado Fracionário", "-", BROKER, "ABCD3F", 5, 10, 50],
      ["06/03/2026", "Compra", "Mercado à Vista", "-", BROKER, "FICT11", 10, 90, 900],
      ["09/03/2026", "Venda", "Mercado à Vista", "-", BROKER, "ABCD3", 50, 12, 600],
      ["09/03/2026", "Compra", "Opção de Compra", "03/2026", BROKER, "ABCDC100", 100, 1, 100],
    ],
  });

export const movimentacao = () =>
  workbook("movimentacao-2026-03.xlsx", {
    Movimentação: [
      [
        "Entrada/Saída",
        "Data",
        "Movimentação",
        "Produto",
        "Instituição",
        "Quantidade",
        "Preço unitário",
        "Valor da Operação",
      ],
      // Liquidação da compra de 05/03: a mesma da Negociação.
      [
        "Credito",
        "09/03/2026",
        "Transferência - Liquidação",
        "ABCD3 - ABCD SA",
        BROKER,
        105,
        10,
        1050,
      ],
      ["Credito", "10/03/2026", "Dividendo", "ABCD3 - ABCD SA", BROKER, 105, 0.5, 52.5],
      ["Credito", "11/03/2026", "Desdobro", "ABCD3 - ABCD SA", BROKER, 55, null, null],
      ["Credito", "12/03/2026", "Transferência", "ABCD3 - ABCD SA", BROKER, 10, null, null],
    ],
  });

export const posicao = () =>
  workbook("posicao-2026-03-31.xlsx", {
    Acoes: [
      [
        "Produto",
        "Instituição",
        "Conta",
        "Código de Negociação",
        "Quantidade",
        "Quantidade Disponível",
        "Preço de Fechamento",
        "Valor Atualizado",
      ],
      ["ABCD3 - ABCD SA", BROKER, "1", "ABCD3", 55, 55, 12, 660],
      ["QWER4 - QWER SA", BROKER, "1", "QWER4", 20, 20, 8, 160],
    ],
    "Renda Fixa": [
      ["Produto", "Valor"],
      ["CDB - BANCO EXEMPLO", 1000],
    ],
  });

/** Mesmas colunas de `packages/domain/src/dividend-file.ts`. ABCD3 e FICT11 vêm de `negociacao`. */
export const proventosRecebidos = (name = "proventos-recebidos-2026-03.xlsx") =>
  workbook(name, {
    "Proventos Recebidos": [
      [
        "Produto",
        "Pagamento",
        "Tipo de Evento",
        "Instituição",
        "Quantidade",
        "Preço unitário",
        "Valor líquido",
      ],
      ["ABCD3 - ABCD SA", "16/03/2026", "Dividendo", BROKER, 55, 0.5, 27.5],
      // Pagamento antes de 2026: 15%, calculado a partir do líquido.
      ["ABCD3 - ABCD SA", "15/12/2025", "Juros Sobre Capital Próprio", BROKER, 55, 1, 85],
      ["FICT11 - FUNDO FICTICIO", "16/03/2026", "Rendimento", BROKER, 10, 0.8, 8],
      // Sem data-com conhecida, a alíquota de 2026 fica para a pessoa conferir.
      ["ABCD3 - ABCD SA", "20/03/2026", "Juros Sobre Capital Próprio", BROKER, 55, 1, 41.25],
      ["QWER4 - QWER SA", "17/03/2026", "Dividendo", BROKER, 20, 0.5, 10],
      ["ABCD3 - ABCD SA", "18/03/2026", "Reembolso", BROKER, 5, 0.5, 2.5],
      ["Total líquido", null, null, null, null, null, 174.25],
    ],
  });

export const movimentacaoProventos = () =>
  workbook("movimentacao-proventos-2026-03.xlsx", {
    Movimentação: [
      [
        "Entrada/Saída",
        "Data",
        "Movimentação",
        "Produto",
        "Instituição",
        "Quantidade",
        "Preço unitário",
        "Valor da Operação",
      ],
      // A mesma linha de Proventos recebidos, e uma nova.
      ["Credito", "16/03/2026", "Dividendo", "ABCD3 - ABCD SA", BROKER, 55, 0.5, 27.5],
      ["Credito", "23/03/2026", "Rendimento", "FICT11 - FUNDO FICTICIO", BROKER, 10, 0.9, 9],
      [
        "Debito",
        "23/03/2026",
        "Rendimento - Transferido",
        "FICT11 - FUNDO FICTICIO",
        BROKER,
        10,
        0.9,
        9,
      ],
      [
        "Credito",
        "09/03/2026",
        "Transferência - Liquidação",
        "ABCD3 - ABCD SA",
        BROKER,
        105,
        10,
        1050,
      ],
    ],
  });

const textFile = (name: string, content: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(content),
});

/** Nome e CPF fictícios de propósito: a tela não pode mandá-los ao servidor. */
export const FICTIONAL_NAME = "Pessoa Ficticia";
export const FICTIONAL_CPF = "000.000.000-00";

export const proventosCsv = () =>
  textFile(
    "proventos.csv",
    [
      "Data;Ativo;Tipo;Bruto;IR;Líquido;Titular;CPF",
      `30/03/2026;ABCD3;JCP;100,00;17,50;82,50;${FICTIONAL_NAME};${FICTIONAL_CPF}`,
      `31/03/2026;FICT11;Rendimento;12,00;0,00;12,00;${FICTIONAL_NAME};${FICTIONAL_CPF}`,
    ].join("\n"),
  );

export const proventosCsvSemTitulos = () =>
  textFile(
    "proventos-minha-planilha.csv",
    "Quando;Papel;Natureza;Quanto\n02/03/2026;ABCD3;Dividendo;4,00\n",
  );

/** A linha de FICT11 de `proventosCsv`, com outro valor. */
export const proventosCsvOutroValor = () =>
  textFile(
    "proventos-corrigido.csv",
    "Data;Ativo;Tipo;Valor\n31/03/2026;FICT11;Rendimento;15,00\n",
  );

export const csvTexto = () => textFile("anotacao.csv", "uma frase qualquer\n");

export const unknownSheet = () =>
  workbook("gastos.xlsx", {
    Plan1: [
      ["Nome", "Telefone"],
      ["Ana", "1"],
    ],
  });

/** Mesma operação da Negociação, agora com as taxas; `ABCD SA ON NM` não traz o código. */
const noteText = (trades: string[], total: string, net: string) => [
  "NOTA DE NEGOCIACAO",
  "Nr. nota Folha Data pregao",
  "12345 1 05/03/2026",
  "CORRETORA EXEMPLO S.A. CNPJ 00.000.000/0001-00",
  "Cliente Pessoa Ficticia C.P.F./C.N.P.J 000.000.000-00",
  "Negocios realizados",
  "Q Negociacao C/V Tipo mercado Prazo Especificacao do titulo Obs. Quantidade Preco Valor D/C",
  ...trades,
  "Resumo dos Negocios Resumo Financeiro",
  `Compras a vista ${total} Taxa de liquidacao 0,25 D`,
  "Emolumentos 0,05 D",
  "Taxa Operacional 0,00 D",
  "Impostos 0,00",
  "I.R.R.F. s/ operacoes, base R$0,00 0,00",
  "Outros 0,00 C",
  `Liquido para 09/03/2026 ${net} D`,
];

function pdfOf(lines: string[], options: jsPDFOptions = {}) {
  const doc = new jsPDF(options);
  doc.setFontSize(8);
  lines.forEach((line, index) => doc.text(line, 10, 12 + index * 6));
  return Buffer.from(doc.output("arraybuffer"));
}

const pdfFile = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });

export const notaComCodigo = () =>
  pdfFile(
    "nota-12345.pdf",
    pdfOf(
      noteText(
        [
          "1-BOVESPA C VISTA ABCD3 ON NM 100 10,00 1.000,00 D",
          "1-BOVESPA C FRACIONARIO ABCD3F ON NM 5 10,00 50,00 D",
        ],
        "1.050,00",
        "1.050,30",
      ),
    ),
  );

export const notaSemCodigo = () =>
  pdfFile(
    "nota-sem-codigo.pdf",
    pdfOf(
      noteText(["1-BOVESPA C VISTA EMPRESA FICTICIA ON NM 10 20,00 200,00 D"], "200,00", "200,30"),
    ),
  );

export const notaImagem = () => {
  const doc = new jsPDF();
  doc.rect(10, 10, 100, 100, "F");
  return pdfFile("nota-escaneada.pdf", Buffer.from(doc.output("arraybuffer")));
};

export const notaComSenha = () =>
  pdfFile(
    "nota-protegida.pdf",
    pdfOf(["Nota protegida"], {
      encryption: { userPassword: "000", ownerPassword: "111", userPermissions: ["print"] },
    }),
  );
