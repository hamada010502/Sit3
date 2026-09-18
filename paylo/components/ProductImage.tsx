/* eslint-disable @next/next/no-img-element */
export function ProductImage({ images, alt, className = '' }: { images: string; alt: string; className?: string }) {
  let list: string[] = [];
  try { list = JSON.parse(images); } catch {}
  if (list.length === 0) {
    return <div className={`bg-karry flex items-center justify-center text-bluewood/30 ${className}`}><span className="text-4xl">▣</span></div>;
  }
  return <img src={list[0]} alt={alt} className={`object-cover ${className}`} />;
}
export function parseImages(images: string): string[] { try { return JSON.parse(images); } catch { return []; } }
