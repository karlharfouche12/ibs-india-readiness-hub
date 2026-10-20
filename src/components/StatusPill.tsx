export function StatusPill({ status }: { status: string }) {
  const tone = status === 'At Risk' ? 'red' : status === 'Closed' ? 'green' : '';
  return <span className={`pill ${tone}`}>{status || 'No status'}</span>;
}
