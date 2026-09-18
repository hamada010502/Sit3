import { Nav } from './Nav';
import { Footer } from './Footer';
export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <Nav />
      <main className={`mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-3xl'} px-4 py-8 flex-1`}>{children}</main>
      <Footer />
    </>
  );
}
