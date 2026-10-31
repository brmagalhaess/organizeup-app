export default function Loading() {
  return (
    <div role="status" aria-label="Carregando" className="flex animate-pulse flex-col gap-4">
      <div className="h-9 w-64 rounded-xl bg-line" />
      <div className="h-2 rounded-full bg-line" />
      <div className="h-96 rounded-2xl bg-line" />
    </div>
  );
}
