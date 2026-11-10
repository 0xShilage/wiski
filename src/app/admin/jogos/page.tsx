import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { GamesBoard } from '@/components/admin/GamesBoard';
import { listGames } from '@/server/games/games';

export const metadata: Metadata = { title: 'Jogos' };

/** /admin/jogos (2026-11-09) — the games shown on /jogos (moderators and the streamer). */
export default async function GamesAdminPage() {
  const p = await adminPage('/admin/jogos');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="jogos"
      title="Jogos"
      lead="Os jogos que passaram na live, na página Jogos: só vitrine, sem patrocínio. Capa 2:3, plataforma, situação e o link do VOD (Twitch ou YouTube)."
      {...p.shell}
    >
      <GamesBoard initial={JSON.parse(JSON.stringify(await listGames()))} />
    </AdminShell>
  );
}
