import { useState } from "react";

interface Props { src: string; alt: string; className?: string; loading?: "lazy" | "eager" }

export function EvidenceImage({ src, alt, className, loading }: Props) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = !src || failedSource === src;
  return failed ? <div className={`evidence-unavailable ${className ?? ""}`} role="status">
    <strong>Кадр недоступен</strong><span>Медиафайл мог быть удалён или соединение прервано.</span>
    {src && <button type="button" className="quiet-button" onClick={() => setFailedSource(null)}>Повторить загрузку</button>}
  </div> : <img src={src} alt={alt} className={className} loading={loading} onError={() => setFailedSource(src)} />;
}
