import type { Metadata } from 'next';
import { LegalPlaceholder } from '@/components/layout/LegalPlaceholder';

export const metadata: Metadata = { title: 'Política de privacidade' };

export default function PrivacidadePage() {
  return (
    <LegalPlaceholder title="Política de privacidade">
      <p>Enquanto a política definitiva não é publicada, resumimos o que o site faz hoje:</p>
      <ul className="list-disc space-y-2 pl-6">
        <li>
          Login com Google: guardamos o identificador da sua conta Google, seu e-mail (nunca
          exibido), o nome de usuário e o avatar que você escolher.
        </li>
        <li>
          Cookies: apenas os necessários para o login e a segurança da sua sessão. Não usamos
          cookies de publicidade nem de análise.
        </li>
        <li>
          Segurança: registros técnicos guardam o seu endereço IP apenas de forma cifrada (HMAC) e
          por até 30 dias.
        </li>
        <li>
          Trailers: o player do YouTube (youtube-nocookie.com) só é carregado quando você clica em
          “Assistir trailer”; antes disso, nada é enviado ao Google.
        </li>
        <li>Você pode encerrar suas sessões a qualquer momento em “Perfil › Sessões ativas”.</li>
      </ul>
      <h2 id="canal-lgpd" className="text-h3 font-semibold text-lilac">
        Canal de privacidade (LGPD)
      </h2>
      <p>
        O canal oficial para pedidos sobre seus dados pessoais (acesso, correção, exclusão) será
        publicado aqui junto com a política definitiva.
      </p>
    </LegalPlaceholder>
  );
}
