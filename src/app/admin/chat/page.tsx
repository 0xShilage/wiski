import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';
import { adminPage } from '@/components/admin/admin-page';
import { AnnouncePanel } from '@/components/admin/AnnouncePanel';
import { ChatPanel } from '@/components/admin/ChatPanel';
import { announceSettings } from '@/server/chat/announce';
import { chatBotConfigured } from '@/server/chat/bot';
import { chatPanel } from '@/server/chat/say';

export const metadata: Metadata = { title: 'Chat da live' };

/** /admin/chat — write to the Twitch chat as the StreamElements bot (moderators and the streamer). */
export default async function ChatAdminPage() {
  const p = await adminPage('/admin/chat');
  if ('gate' in p) return p.gate;
  return (
    <AdminShell
      active="chat"
      title="Chat da live"
      lead="Escreva no chat do Twitch como o bot do StreamElements. Tudo o que sai daqui fica registrado com quem enviou (aqui e na Auditoria)."
      {...p.shell}
    >
      <ChatPanel initial={await chatPanel()} />
      <AnnouncePanel initial={await announceSettings()} ready={chatBotConfigured()} />
    </AdminShell>
  );
}
