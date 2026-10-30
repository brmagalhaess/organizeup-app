// Prévia ilustrativa do resumo do mês. Sempre exibida com o aviso de valores fictícios.
const rows = [
  { label: "Salário", detail: "Dia 5", value: "+ R$ 7.200,00", positive: true },
  { label: "Financiamento", detail: "Dia 10", value: "− R$ 1.640,00", positive: false },
  { label: "Mercado", detail: "Dia 12", value: "− R$ 980,00", positive: false },
  { label: "Reserva da viagem", detail: "Dia 15", value: "− R$ 450,00", positive: false },
];

const months = [46, 58, 52, 64, 70, 66, 78, 84];

export function ProductPreview() {
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-[0_30px_80px_-30px_rgba(21,35,29,0.45)]">
        <div className="flex items-center justify-between border-b border-sand-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone">
              Família Oliveira
            </p>
            <p className="font-display text-xl text-night">Março em um olhar</p>
          </div>
          <span className="rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-pine">
            No plano
          </span>
        </div>

        <div className="grid gap-px bg-sand-100 sm:grid-cols-3">
          {[
            ["Entrou", "R$ 7.200,00"],
            ["Saiu", "R$ 4.930,00"],
            ["Sobrou", "R$ 2.270,00"],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-6 py-4">
              <p className="text-xs text-stone">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-night">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[1fr_13rem]">
          <ul className="m-0 list-none divide-y divide-sand-100 p-0">
            {rows.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-night">{row.label}</p>
                  <p className="text-xs text-stone">{row.detail}</p>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    row.positive ? "text-pine" : "text-clay"
                  }`}
                >
                  {row.value}
                </p>
              </li>
            ))}
          </ul>

          <div aria-hidden="true" className="flex flex-col justify-end rounded-2xl bg-sand-50 p-4">
            <p className="mb-3 text-xs font-semibold text-stone">Patrimônio da família</p>
            <div className="flex h-32 items-end gap-1.5">
              {months.map((height, index) => (
                <span
                  key={index}
                  className="flex-1 rounded-t bg-pine/80 last:bg-clay"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-stone">
        Tela ilustrativa, com valores e família fictícios.
      </figcaption>
    </figure>
  );
}
