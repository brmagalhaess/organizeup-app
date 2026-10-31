export default function Loading() {
  return (
    <div role="status" aria-label="Carregando" className="flex animate-pulse flex-col gap-6">
      <div className="h-16 w-64 max-w-full rounded-2xl bg-line" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="h-28 rounded-2xl bg-line" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="h-80 rounded-2xl bg-line" />
        <div className="h-80 rounded-2xl bg-line" />
      </div>
    </div>
  );
}
