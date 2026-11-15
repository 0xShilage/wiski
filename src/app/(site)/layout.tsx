import { Suspense, type ReactNode } from 'react';
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
    </>
  );
}
