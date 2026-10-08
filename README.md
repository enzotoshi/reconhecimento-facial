# Acesso facial com MediaPipe

Interface em HTML, CSS e JavaScript com Vite e `@mediapipe/tasks-vision` 1.1.0. O Face Landmarker detecta contornos faciais reais em tempo real. A moldura fixa continua sendo apenas um guia de posicionamento. A aplicação não confirma identidade nem libera acesso.

## Rodar localmente

Com Node.js 22.12+ ou 24 instalado, execute na pasta do projeto:

```sh
npm ci
npm start
```

Abra http://localhost:8000 e clique em **Iniciar câmera**. O modelo é inicializado somente após a câmera começar. A interface mostra carregamento, ausência de rosto, um rosto, múltiplos rostos ou erro. A confirmação de identidade continua indicando **Não configurada**. Para encerrar o servidor, pressione Ctrl+C.

O primeiro `npm start` baixa o modelo oficial (aproximadamente 3,8 MB), valida seu SHA-256 e copia os arquivos WASM da versão instalada para `public/mediapipe/`. A internet é necessária para instalar dependências e preparar os recursos pela primeira vez. Inícios posteriores reutilizam o modelo local validado. Os recursos gerados não entram no controle de versão; `npm run assets` pode prepará-los manualmente. Os arquivos antigos de servidor e build estáticos foram substituídos pelo Vite; não use Python para servir os fontes com imports npm.

Para acessar a câmera é necessário localhost ou HTTPS. Abrir por HTTP usando o IP da rede local em um celular geralmente não permite a captura; para testar no celular, sirva a página por HTTPS. Não abra o HTML diretamente: os módulos JavaScript precisam do servidor.

## Verificar e gerar a versão estática

```sh
npm run check
npm test
npm run build
npm run preview
```

O build valida a sintaxe, prepara os recursos e empacota aplicação, worker, modelo e WASM em `dist/`. `npm run preview` serve esse build na porta 8000; encerre o servidor de desenvolvimento antes. Publique `dist/` em uma hospedagem estática com HTTPS. A sintaxe é verificada por `npm run check`; não há lint externo.

Teste manualmente: permitir e negar a câmera, cancelar enquanto a permissão ou o modelo estiverem pendentes, parar e reiniciar, trocar de câmera, desconectar o dispositivo e sair da página. Ao parar, o indicador do navegador deve desligar e os contornos sumir. Teste também sem rosto e com duas pessoas. O modelo tem limite de duas faces para permitir avisar sobre múltiplos rostos; não é um contador de pessoas nem uma prova de vivacidade.

Com o servidor ativo, `npm run test:browser` executa QA no Edge/Chrome instalado (ou no executável indicado por `BROWSER_BINARY`), usando vídeo de teste e um retrato público oficial do MediaPipe. O resultado de detecção é calculado pelo modelo real. O script verifica captura por clique, inferência, sobreposição, viewport móvel, parada durante carregamento e erros de câmera. Não usa sua câmera física. Para testar outro endereço: `npm run test:browser -- http://127.0.0.1:8001`.

## Arquitetura

- `src/camera.js`: solicita câmera frontal por preferência, permite selecionar dispositivo e encerra todas as faixas. Descarta streams recebidos após cancelar uma solicitação pendente.
- `src/analysis.js`: único agendador, com `requestVideoFrameCallback` e fallback para `requestAnimationFrame`. Limita o processamento a até 15 FPS, evita repetir quadros, aguarda inferências pendentes e descarta resultados de sessões encerradas.
- `src/integration.js`: adaptador com `initialize`, `detect`, `draw` e `close`. Transfere `ImageBitmap` temporário para o worker, trata timeout e rejeita solicitações pendentes ao encerrar.
- `src/face-worker.js`: inicializa o Face Landmarker em modo `VIDEO` com execução CPU, roda inferências fora da interface e fecha cada bitmap. O runtime WASM usa formato módulo ES, compatível com o worker. Terminar o worker libera modelo e memória WASM.
- `src/overlay.js`: desenha contornos retornados pelo modelo, em coordenadas nativas do vídeo. Vídeo e canvas usam `object-fit: contain` e são espelhados juntos quando a câmera informa orientação frontal.
- `src/app.js`: coordena captura, carregamento, resultados e erro de análise. Falhar na análise mantém a câmera controlável. `dispose()` encerra captura e worker ao sair; também pode ser usado na desmontagem de um componente.

## Recursos e privacidade

Os quadros ficam na memória do navegador/worker e são liberados após uso. A aplicação não grava, envia ou armazena persistentemente imagens, nem realiza cadastro biométrico. Modelo e WASM são servidos pelo mesmo servidor da página, sem CDN em tempo de captura.

A [documentação de privacidade do pacote oficial](https://www.npmjs.com/package/@mediapipe/tasks-vision) informa que MediaPipe processa as entradas no dispositivo e pode enviar métricas técnicas de uso/desempenho ao Google; essas métricas são distintas das imagens. Servir os recursos localmente não garante ausência total de telemetria da biblioteca. Revise essa política antes de disponibilizar o produto a usuários.

Modelo: [Face Landmarker float16, revisão 1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task). SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`. Referência: [guia oficial para Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

## Autenticação futura

**Detecção facial não é autenticação.** Confirmar a identidade exigirá uma implementação independente com cadastro e consentimento, comparação biométrica, critérios de correspondência, proteção contra apresentação de fotos/vídeos e gestão segura de sessões e autorização. MediaPipe pode fornecer detecção ou pontos do rosto; esses resultados sozinhos não confirmam a identidade nem liberam acesso. Qualquer futura coleta ou transmissão biométrica exigirá revisar o comportamento de privacidade desta versão.
