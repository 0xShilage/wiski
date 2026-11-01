/**
 * "Política de Privacidade e Proteção de Dados" (2026-11-01): the single legal text that replaces
 * the separate Termos de uso and Política de privacidade pages, converted from the streamer's
 * ASSETS/TERMS_PRIVACY.docx without changing a word. Rendered by `src/lib/legal-text.ts`:
 *
 *   ## / ###   section headings ("1. …", "3.1. …")  ·  "- " list items  ·  **bold**  ·  <https://…>
 *   {site} {domain} {controller} {email} {dpo}  →  LEGAL_CONTROLLER below
 *
 * A new version: replace LEGAL_TEXT and bump LEGAL_UPDATED (then register it for checkout, Q13).
 */
export const LEGAL_TITLE = 'Política de Privacidade e Proteção de Dados';
export const LEGAL_UPDATED = '2026-11-01';

/**
 * The document's blanks. `null` = not filled in yet: the page shows "[a definir]" there and a
 * notice that the text is provisional, until every value is set.
 */
export const LEGAL_CONTROLLER: Record<
  'site' | 'domain' | 'controller' | 'email' | 'dpo',
  string | null
> = {
  site: 'Wiski',
  domain: 'wiski.fun',
  controller: null, // "[NOME DA RESPONSÁVEL OU RAZÃO SOCIAL]"
  email: null, // "[E-MAIL DE CONTATO]"
  dpo: null, // "[NOME OU IDENTIFICAÇÃO]" (responsável pelo tratamento)
};

export const LEGAL_TEXT = String.raw`
Esta Política de Privacidade estabelece as condições de coleta, utilização, armazenamento, processamento, compartilhamento e proteção de dados pessoais dos usuários que acessam e utilizam a plataforma **WISKI**, destinada ao recebimento de patrocínios voluntários para apoiar transmissões de filmes e séries realizadas por uma streamer na plataforma Twitch.

Este documento foi elaborado em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD) e demais normas aplicáveis à proteção de dados pessoais no Brasil.

Ao acessar ou utilizar a plataforma, o usuário declara estar ciente das práticas de tratamento de dados aqui descritas.

## 1. IDENTIFICAÇÃO DO CONTROLADOR

A plataforma **{site}**, disponível em **{domain}**, é administrada por **{controller}**, doravante denominada CONTROLADORA.

A CONTROLADORA é responsável pelas decisões referentes ao tratamento dos dados pessoais realizados no âmbito da plataforma, respeitadas as operações conduzidas diretamente por fornecedores terceiros sob suas próprias responsabilidades.

Para assuntos relacionados à privacidade, proteção de dados pessoais ou exercício dos direitos previstos na LGPD, o usuário poderá entrar em contato pelo seguinte canal:

- E-mail: {email}

- Responsável pelo tratamento: {dpo}

## 2. FINALIDADE DA PLATAFORMA

A plataforma tem como finalidade permitir que usuários realizem contribuições financeiras voluntárias destinadas ao apoio das atividades de transmissão de filmes e séries na Twitch.

As contribuições possuem caráter voluntário e não representam, por si só, a aquisição de produtos, serviços, participação societária ou qualquer obrigação de contraprestação por parte da administradora.

A plataforma também oferece funcionalidades de identificação e autenticação de usuários, gerenciamento de contas e processamento de contribuições financeiras.

O tratamento de dados pessoais ocorre na medida necessária para disponibilizar essas funcionalidades, processar contribuições, garantir a segurança da infraestrutura e cumprir obrigações legais.

## 3. AUTENTICAÇÃO E ACESSO À PLATAFORMA

### 3.1. Autenticação exclusiva pelo Google

O acesso às contas de usuário da plataforma é realizado exclusivamente por meio do sistema de autenticação da Google, utilizando o mecanismo oficial de identificação disponibilizado pelo Google Sign-In e tecnologias relacionadas ao protocolo OpenID Connect.

A plataforma não oferece autenticação própria por senha, nem permite a criação de credenciais de acesso independentes de uma Conta Google.

Para acessar sua conta, o usuário deverá utilizar uma Conta Google válida e concluir o procedimento de autenticação disponibilizado pelo próprio Google.

### 3.2. Dados recebidos durante a autenticação

Durante o procedimento de autenticação, a plataforma poderá receber e tratar as seguintes informações disponibilizadas pelo Google, conforme as permissões efetivamente solicitadas e autorizadas:

- Nome de exibição do usuário.

- Endereço de e-mail associado à Conta Google.

- Identificador exclusivo da conta Google (Google User ID ou claim sub).

- Fotografia de perfil, quando disponibilizada.

- Informação sobre a verificação do endereço de e-mail.

- Informações técnicas relacionadas à autenticação e validação da identidade.

O identificador exclusivo da Conta Google é utilizado para reconhecer e vincular o usuário ao respectivo cadastro interno da plataforma.

O endereço de e-mail poderá ser utilizado para identificação complementar e comunicações relacionadas à conta, quando aplicável.

### 3.3. Ausência de acesso às credenciais do Google

A plataforma não recebe, armazena ou solicita a senha da Conta Google do usuário.

A autenticação é realizada diretamente pelo ambiente de segurança do Google, cabendo à plataforma receber apenas as informações de identificação disponibilizadas pelo processo de autenticação.

A CONTROLADORA não possui acesso às credenciais de login, métodos de autenticação, códigos de verificação ou demais informações privadas utilizadas pelo usuário para acessar sua Conta Google.

### 3.4. Limitação das permissões solicitadas

A utilização do Google Sign-In não concede automaticamente à plataforma acesso a todos os dados ou serviços associados à Conta Google do usuário.

A autenticação destina-se à identificação e ao acesso à plataforma.

A CONTROLADORA não solicita, como parte do procedimento ordinário de autenticação, acesso ao conteúdo do Gmail, Google Drive, Google Fotos, contatos, calendário ou demais serviços pessoais do Google.

Qualquer ampliação futura das permissões deverá ser devidamente justificada, limitada à finalidade necessária e informada ao usuário antes de sua utilização, observadas as exigências legais aplicáveis.

### 3.5. Responsabilidade sobre a Conta Google

O usuário é responsável pela segurança de sua Conta Google, incluindo a manutenção de suas credenciais e o controle de seus métodos de autenticação.

Problemas relacionados ao acesso, recuperação, bloqueio, suspensão ou segurança da Conta Google deverão ser tratados diretamente com o Google.

A indisponibilidade ou perda de acesso à Conta Google poderá impedir o acesso à conta correspondente na plataforma.

## 4. DADOS PESSOAIS COLETADOS

A plataforma poderá coletar e tratar as seguintes categorias de dados pessoais:

### 4.1. Dados de identificação e conta

- Identificador exclusivo da conta Google.

- Nome de exibição.

- Endereço de e-mail.

- Fotografia de perfil, quando disponibilizada.

- Data de criação da conta.

- Registros de autenticação e sessões.

- Informações necessárias ao gerenciamento da conta.

A disponibilidade de cada informação dependerá das permissões concedidas pelo usuário durante a autenticação e da configuração da integração utilizada.

### 4.2. Dados relacionados às contribuições financeiras

Durante o processo de contribuição, poderão ser tratados:

- Valor da contribuição.

- Data e horário da transação.

- Identificador da transação.

- Situação do pagamento.

- Informações de identificação disponibilizadas pelo intermediador financeiro.

- Informações necessárias à identificação, confirmação e conciliação do pagamento.

Os dados completos de cartões de crédito, códigos de segurança, credenciais bancárias e demais informações financeiras são processados pelo Mercado Pago, conforme a modalidade de pagamento utilizada e suas próprias políticas.

A plataforma não pretende armazenar diretamente os dados completos dos instrumentos de pagamento utilizados pelos usuários.

### 4.3. Dados técnicos e de navegação

Durante o acesso à plataforma, poderão ser coletadas automaticamente informações como:

- Endereço IP.

- Data e horário de acesso.

- Informações sobre navegador e sistema operacional.

- Tipo de dispositivo utilizado.

- Informações sobre requisições HTTP.

- Identificadores técnicos e informações de sessão.

- Registros de erros e eventos de segurança.

- Informações relacionadas à identificação de comportamentos automatizados ou suspeitos.

Esses dados são utilizados principalmente para garantir a disponibilidade, estabilidade, segurança e integridade da plataforma.

## 5. FINALIDADES E BASES LEGAIS DO TRATAMENTO

Os dados pessoais coletados poderão ser utilizados para as seguintes finalidades:

- Criar, identificar e administrar contas de usuários.

- Permitir a autenticação por meio do Google.

- Manter sessões de acesso e garantir a continuidade da utilização da plataforma.

- Processar, identificar e confirmar contribuições financeiras.

- Manter registros de transações e movimentações.

- Prevenir fraudes, abusos e atividades ilícitas.

- Identificar acessos automatizados e comportamentos maliciosos.

- Proteger a infraestrutura contra ataques cibernéticos.

- Diagnosticar falhas técnicas e melhorar a disponibilidade do serviço.

- Cumprir obrigações legais, regulatórias e fiscais.

- Exercer regularmente direitos em procedimentos administrativos, judiciais ou extrajudiciais.

O tratamento será fundamentado, conforme a finalidade e a natureza de cada operação, nas seguintes hipóteses legais previstas na LGPD:

- Execução de contrato ou de procedimentos preliminares relacionados a contrato, quando aplicável.

- Cumprimento de obrigação legal ou regulatória.

- Exercício regular de direitos.

- Legítimo interesse, especialmente para segurança da informação, prevenção de fraudes e proteção da infraestrutura, observados os direitos e as liberdades fundamentais dos titulares.

- Consentimento, quando necessário e juridicamente aplicável.

## 6. SERVIÇOS DE TERCEIROS E COMPARTILHAMENTO DE DADOS

Para garantir o funcionamento, a autenticação, a segurança e o processamento financeiro da plataforma, são utilizados serviços de terceiros especializados.

Esses fornecedores poderão realizar operações de tratamento de dados pessoais conforme suas respectivas funções, contratos, políticas de privacidade e obrigações legais.

### 6.1. Google — Autenticação e identificação de usuários

O Google é utilizado como provedor exclusivo de autenticação da plataforma.

O serviço permite identificar os usuários e validar suas identidades por meio de suas respectivas Contas Google.

Durante esse procedimento, informações como identificador exclusivo da conta, nome, endereço de e-mail e fotografia de perfil poderão ser disponibilizadas à plataforma, conforme as permissões utilizadas.

O Google realiza o processamento necessário à autenticação e à disponibilização de suas funcionalidades, de acordo com seus próprios termos e políticas de privacidade.

A plataforma não recebe as senhas das Contas Google e não possui acesso automático aos demais serviços ou conteúdos associados a essas contas.

Política de Privacidade do Google:

<https://policies.google.com/privacy?hl=pt-BR>

Documentação oficial do sistema de autenticação:

<https://developers.google.com/identity/openid-connect/openid-connect?hl=pt-br>

### 6.2. Mercado Pago — Processamento financeiro

O Mercado Pago é utilizado como intermediador e processador de pagamentos, possibilitando a realização de contribuições financeiras.

Durante uma operação, o Mercado Pago poderá coletar e processar informações como:

- Dados de identificação do pagador.

- Informações financeiras e de pagamento.

- Dados de autenticação e validação da transação.

- Informações relacionadas à prevenção de fraudes.

- Identificadores e registros da operação financeira.

A plataforma poderá receber informações relacionadas ao resultado da transação, como valor, identificador, situação do pagamento e demais dados disponibilizados pela integração utilizada.

O Mercado Pago possui suas próprias práticas de tratamento de dados e atua de acordo com sua própria política de privacidade.

Política de Privacidade do Mercado Pago:

<https://www.mercadopago.com.br/privacidade/declaracao-privacidade/2.0>

### 6.3. Cloudflare Turnstile — Verificação de interações

A plataforma utiliza o Cloudflare Turnstile como mecanismo de verificação e proteção contra interações automatizadas.

O serviço auxilia na distinção entre usuários humanos e sistemas automatizados, reduzindo o envio de solicitações maliciosas, spam e tentativas de abuso.

Durante esse processo, poderão ser tratados sinais técnicos relacionados à interação do usuário com a plataforma, incluindo informações do navegador, dispositivo e características da requisição.

O Turnstile é utilizado para fins de segurança e prevenção de atividades automatizadas indevidas.

Política de Privacidade da Cloudflare e adendo do Turnstile:

<https://www.cloudflare.com/pt-br/privacypolicy/>

### 6.4. Cloudflare DDoS Protection — Proteção contra ataques

A plataforma utiliza os mecanismos de proteção contra ataques de negação de serviço distribuídos (DDoS) disponibilizados pela Cloudflare.

Esses mecanismos analisam padrões de tráfego e requisições de rede para identificar e mitigar atividades que possam comprometer a disponibilidade da plataforma.

Durante esse processo, poderão ser tratados:

- Endereços IP de origem.

- Informações de cabeçalhos HTTP.

- Metadados das requisições.

- Informações sobre protocolos de comunicação.

- Frequência e volume de acessos.

- Indicadores técnicos de comportamento suspeito.

O tratamento dessas informações é necessário para proteger a infraestrutura contra ataques, sobrecargas e tentativas de indisponibilização do serviço.

### 6.5. Cloudflare Bot Management — Gerenciamento de tráfego automatizado

A plataforma utiliza o Cloudflare Bot Management para identificar, classificar e mitigar tráfego automatizado potencialmente malicioso.

O serviço analisa sinais técnicos e padrões de comportamento das requisições para diferenciar acessos legítimos de atividades automatizadas suspeitas.

As informações poderão incluir características do navegador, endereço IP, metadados de conexão, padrões de navegação e outros indicadores técnicos utilizados na classificação do tráfego.

Essas informações são utilizadas para prevenção de fraudes, abuso da plataforma e exploração automatizada de seus recursos.

### 6.6. Cloudflare CDN — Distribuição de conteúdo

A plataforma utiliza a rede de distribuição de conteúdo (CDN) da Cloudflare para melhorar o desempenho, a disponibilidade e a segurança da entrega de conteúdo.

As requisições realizadas pelos usuários poderão transitar pela infraestrutura da Cloudflare, que poderá processar informações como:

- Endereço IP.

- Cabeçalhos HTTP.

- Informações de navegador.

- Dados de requisições e respostas.

- Informações técnicas de conexão.

- Registros necessários à operação e segurança da infraestrutura.

A CDN poderá armazenar temporariamente determinados conteúdos em cache, conforme as configurações técnicas da plataforma, com o objetivo de otimizar a entrega de recursos e reduzir a latência.

A Cloudflare possui suas próprias práticas de tratamento de dados, conforme sua política de privacidade.

Política de Privacidade da Cloudflare:

<https://www.cloudflare.com/pt-br/privacypolicy/>

## 7. COMPARTILHAMENTO DE INFORMAÇÕES

A CONTROLADORA não comercializa, vende ou disponibiliza deliberadamente dados pessoais dos usuários a terceiros para fins de publicidade ou comercialização de informações.

O compartilhamento poderá ocorrer nas seguintes circunstâncias:

- Com o Google, para autenticação e identificação de usuários.

- Com o Mercado Pago, para processamento e validação de contribuições financeiras.

- Com a Cloudflare, para funcionamento da infraestrutura, distribuição de conteúdo e proteção contra ameaças digitais.

- Com autoridades públicas, órgãos reguladores e autoridades judiciais, quando exigido por lei ou mediante solicitação juridicamente válida.

- Com prestadores de serviços técnicos, quando necessário para manutenção, suporte e funcionamento da plataforma.

- Quando necessário para prevenir fraudes, investigar atividades ilícitas ou proteger direitos da CONTROLADORA e de terceiros.

O compartilhamento será limitado ao necessário para o cumprimento das respectivas finalidades.

A disponibilização de dados aos fornecedores não significa que todos eles recebam todas as informações coletadas pela plataforma. Cada fornecedor terá acesso apenas aos dados necessários às funcionalidades que executa, conforme a integração e a configuração técnica utilizadas.

## 8. ARMAZENAMENTO E PRAZO DE RETENÇÃO

Os dados pessoais serão armazenados somente pelo período necessário ao cumprimento das finalidades descritas nesta Política, observadas as obrigações legais e regulatórias aplicáveis.

Os períodos de retenção poderão variar conforme a categoria dos dados:

- **Dados de identificação e conta:** enquanto a conta permanecer ativa e pelo período adicional necessário ao cumprimento de obrigações legais ou à proteção de direitos.

- **Identificadores da Conta Google:** enquanto necessários à identificação e manutenção da conta correspondente.

- **Dados de autenticação e sessão:** pelo período necessário ao funcionamento e à segurança das sessões.

- **Dados de transações financeiras:** pelo período necessário à conciliação, comprovação das operações e cumprimento das obrigações legais, fiscais e regulatórias.

- **Registros técnicos e de segurança:** pelo período necessário à investigação de incidentes, prevenção de abusos e manutenção da segurança da plataforma.

- **Dados temporários de navegação:** pelo período necessário ao funcionamento técnico da plataforma.

Encerradas as finalidades do tratamento, os dados serão eliminados, anonimizados ou mantidos nas hipóteses legalmente autorizadas, respeitadas as limitações técnicas e os prazos de retenção aplicáveis.

## 9. COOKIES E TECNOLOGIAS SEMELHANTES

A plataforma poderá utilizar cookies, identificadores técnicos e tecnologias semelhantes para possibilitar seu funcionamento, manter sessões, proteger acessos e otimizar a entrega de conteúdo.

Essas tecnologias poderão ser utilizadas para:

- Garantir o funcionamento de funcionalidades essenciais.

- Manter informações técnicas de sessão.

- Permitir a continuidade da autenticação.

- Auxiliar na prevenção de atividades fraudulentas.

- Identificar comportamentos automatizados.

- Melhorar a segurança e a disponibilidade do serviço.

- Otimizar a entrega de conteúdo por meio da CDN.

O Google e a Cloudflare poderão utilizar cookies ou outros mecanismos técnicos necessários à operação de seus respectivos serviços.

A plataforma não declara utilizar cookies publicitários ou mecanismos de rastreamento comportamental para publicidade direcionada, salvo se essa funcionalidade vier a ser implementada e devidamente informada.

O usuário poderá gerenciar ou restringir cookies por meio das configurações de seu navegador. Entretanto, a desativação de determinadas tecnologias poderá comprometer o funcionamento de funcionalidades essenciais, inclusive a autenticação e a manutenção de sessões.

## 10. SEGURANÇA DA INFORMAÇÃO

A CONTROLADORA adota medidas técnicas e administrativas razoáveis para proteger os dados pessoais contra acessos não autorizados, destruição, perda, alteração, comunicação ou qualquer forma de tratamento inadequado ou ilícito.

Entre as medidas de segurança utilizadas estão:

- Autenticação centralizada por meio do Google.

- Proteção da infraestrutura por meio da Cloudflare.

- Mecanismos de mitigação de ataques DDoS.

- Identificação e mitigação de tráfego automatizado.

- Verificação de interações por meio do Cloudflare Turnstile.

- Distribuição e proteção de conteúdo por meio da Cloudflare CDN.

- Utilização de intermediador especializado para processamento financeiro.

- Restrição de acesso às informações administrativas, conforme necessidade operacional.

Apesar da adoção dessas medidas, nenhum sistema conectado à internet pode garantir segurança absoluta.

Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares, serão adotadas as providências legalmente exigidas, incluindo as comunicações cabíveis à Autoridade Nacional de Proteção de Dados (ANPD) e aos titulares, quando aplicável.

## 11. DIREITOS DOS TITULARES DE DADOS

Nos termos do artigo 18 da LGPD, o usuário poderá solicitar, observadas as condições legais aplicáveis:

- Confirmação da existência de tratamento de seus dados pessoais.

- Acesso aos dados pessoais tratados.

- Correção de informações incompletas, inexatas ou desatualizadas.

- Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a legislação.

- Portabilidade dos dados, quando regulamentada e aplicável.

- Eliminação dos dados tratados com base no consentimento, ressalvadas as hipóteses legais de conservação.

- Informação sobre entidades públicas e privadas com as quais os dados são compartilhados.

- Informação sobre a possibilidade de não fornecer consentimento e suas consequências, quando aplicável.

- Revogação do consentimento, quando essa for a base legal utilizada.

As solicitações deverão ser encaminhadas ao canal de contato indicado na seção 1.

A CONTROLADORA poderá solicitar informações adicionais estritamente necessárias para verificar a identidade do solicitante e impedir o acesso indevido a dados pessoais de terceiros.

O exercício desses direitos será realizado gratuitamente, respeitadas as disposições legais aplicáveis.

## 12. GERENCIAMENTO E EXCLUSÃO DE CONTAS

O usuário poderá solicitar a exclusão de sua conta da plataforma mediante solicitação encaminhada ao canal de contato disponibilizado pela CONTROLADORA.

Após a verificação da identidade do solicitante, a CONTROLADORA adotará as providências necessárias para excluir ou anonimizar os dados pessoais vinculados à conta, ressalvadas as informações cuja conservação seja autorizada ou exigida pela legislação.

A exclusão da conta não implica necessariamente a eliminação imediata de registros financeiros, fiscais, de segurança ou de outros dados que devam ser conservados por obrigação legal ou para o exercício regular de direitos.

A revogação das permissões concedidas ao aplicativo na Conta Google poderá ser realizada diretamente nas configurações de segurança da Conta Google.

A revogação de acesso junto ao Google, entretanto, não substitui a solicitação de exclusão da conta e dos dados eventualmente armazenados na própria plataforma.

Como a autenticação é realizada exclusivamente pelo Google, a perda de acesso à Conta Google poderá impedir novas autenticações na plataforma.

## 13. DADOS DE PAGAMENTO E LIMITAÇÕES DE RESPONSABILIDADE

As operações financeiras realizadas por meio da plataforma são processadas pelo Mercado Pago, que possui infraestrutura, mecanismos de segurança, critérios de validação e políticas próprias.

A CONTROLADORA não possui acesso irrestrito às informações financeiras e credenciais bancárias dos usuários, nem pretende armazenar diretamente dados completos de cartões ou credenciais de pagamento.

Questões relacionadas à autenticação financeira, validação de pagamentos, bloqueios preventivos, estornos e procedimentos internos de processamento deverão ser tratadas diretamente com o Mercado Pago, sem prejuízo das responsabilidades legais da CONTROLADORA sobre os dados pessoais que estiverem sob sua responsabilidade.

## 14. PRIVACIDADE DE CRIANÇAS E ADOLESCENTES

A plataforma não é especificamente direcionada a crianças e não pretende coletar intencionalmente dados pessoais de crianças.

Caso seja identificado tratamento de dados pessoais de crianças ou adolescentes, serão observadas as disposições legais aplicáveis, especialmente o princípio do melhor interesse e as exigências específicas da LGPD.

Quando necessário, poderão ser adotadas medidas para restringir ou interromper o tratamento de informações coletadas em desconformidade com a legislação.

## 15. TRANSFERÊNCIA INTERNACIONAL DE DADOS

Determinados fornecedores utilizados pela plataforma possuem infraestrutura, servidores ou operações localizados fora do território brasileiro.

Consequentemente, dados pessoais poderão ser transferidos ou processados internacionalmente, especialmente em razão da utilização dos serviços do Google e da Cloudflare, sem prejuízo de outras operações internacionais realizadas pelos fornecedores contratados.

As transferências internacionais deverão observar os requisitos previstos na LGPD e no Regulamento de Transferência Internacional de Dados da Autoridade Nacional de Proteção de Dados, aprovado pela Resolução CD/ANPD nº 19/2024, incluindo a adoção de mecanismo legal válido para cada operação, quando aplicável.

Os países de destino, as entidades destinatárias, a duração e as garantias aplicáveis às transferências deverão ser identificados pela CONTROLADORA conforme os serviços, contratos e configurações efetivamente utilizados.

## 16. ALTERAÇÕES DESTA POLÍTICA

Esta Política de Privacidade poderá ser atualizada periodicamente para refletir alterações legislativas, mudanças nos serviços utilizados, modificações na infraestrutura ou aprimoramentos das práticas de proteção de dados.

A versão atualizada será disponibilizada nesta mesma página, acompanhada da respectiva data de atualização.

Recomenda-se que os usuários consultem este documento periodicamente.

## 17. DISPOSIÇÕES FINAIS

A utilização da plataforma implica ciência das práticas de tratamento de dados descritas nesta Política.

Caso alguma disposição deste documento seja considerada inválida ou inexequível, as demais disposições permanecerão válidas, na medida permitida pela legislação aplicável.

Esta Política será interpretada de acordo com as leis da República Federativa do Brasil, especialmente a Lei Geral de Proteção de Dados Pessoais.

Para esclarecimentos, solicitações ou reclamações relacionadas ao tratamento de dados pessoais, o usuário poderá utilizar o canal de contato informado na seção 1.
`;
