import { Suspense, type ReactNode } from 'react';
import { Flashlight } from '@/components/fx/Flashlight';
import { ImageFader } from '@/components/fx/ImageFader';
import { IntentPrefetch } from '@/components/fx/IntentPrefetch';
import { RouteLoader } from '@/components/fx/RouteLoader';
import { TiltLayer } from '@/components/fx/TiltLayer';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { TabBar } from '@/components/layout/TabBar';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="conteudo" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <TabBar />
      <TiltLayer />
      <Suspense fallback={null}>
        <RouteLoader />
      </Suspense>
      <IntentPrefetch />
      <ImageFader />
      {/* material and light (2026-11-14): film grain over everything, a soft light at the mouse */}
      <div className="wf-grain" aria-hidden="true" />
      <Flashlight />
    </>
  );
}
