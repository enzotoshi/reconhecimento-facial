# Acesso facial com MediaPipe

Interface em HTML, CSS e JavaScript com Vite, `@mediapipe/tasks-vision` 1.1.0 e `@vladmandic/face-api` 1.7.15. MediaPipe desenha contornos faciais; FaceAPI extrai descritores e compara o rosto com as fotos cadastradas. A moldura fixa é um guia de posicionamento. O reconhecimento é experimental, sem prova de vivacidade ou liberação de acesso.

## Reconhecimento na Detecção ao vivo

Use **Detecção ao vivo** e inicie a câmera. As fotos já cadastradas no mesmo navegador/endereço são carregadas automaticamente; não é necessário cadastrá-las novamente. O modelo calcula descritores de 128 valores para as fotos e para o rosto no vídeo. Nenhum vetor é gravado no IndexedDB: eles existem somente na memória da sessão e são liberados ao parar a câmera.

A tela exibe o nome após três comparações consecutivas compatíveis. Rosto sem correspondência ou banco vazio exibe **Acesso negado / desconhecido**. Cadastros semelhantes, múltiplos rostos, falha de análise e imagens inadequadas também negam a identificação, informando o motivo. Ausência de rosto, atualização dos cadastros e parada removem o nome anterior. Salvar, adicionar fotos ou excluir na aba de cadastro atualiza a comparação na mesma página. Fotos sem um único rosto com qualidade são ignoradas, com indicação para refazer a captura.

O critério em `src/face-matching.js` mantém distância euclidiana de até **0,50**, com margem de pelo menos **0,07** em relação à segunda pessoa. Se houver várias fotos, usa a média das duas referências mais próximas da mesma pessoa, ambas com distância até **0,55**. Um único acerto isolado entre referências incompatíveis não aceita uma identidade. Distância não é probabilidade ou porcentagem de confiança. Esses parâmetros não foram calibrados com uma população real e podem gerar falsos positivos e negativos. Cadastros da mesma pessoa com nomes diferentes podem tornar o resultado inconclusivo.

A análise é disparada pelos resultados do MediaPipe, com uma única comparação pendente e intervalo mínimo de 500 ms. Usa o detector SSD MobileNet V1, alinhamento de 68 pontos e FaceRecognitionNet, com a mesma preparação para fotos salvas e vídeo. Roda em worker com WebGL quando disponível e alternativa CPU se a aceleração falhar. Em dispositivos lentos pode demorar alguns segundos. Reiniciar ou parar cancela workers e invalida resultados antigos. O nome desaparece após 3 segundos sem atualização; a sequência de leituras expira após uma pausa de mais de 10 segundos, sem reiniciar prematuramente por uma inferência lenta.

`src/recognition-quality.js` rejeita rostos menores que 80 pixels, confiança do detector abaixo de 0,75, imagens muito escuras/estouradas ou com pouco contraste. Isso evita comparar capturas inadequadas, mas não é uma medição completa de nitidez ou vivacidade. Aproxime o rosto e ajuste a iluminação quando solicitado.

## Cadastrar rostos

Selecione **Cadastrar rosto**, inicie a câmera e mantenha apenas uma pessoa visível. Informe o nome e clique em **Capturar rosto**. O MediaPipe analisa a foto congelada; a captura é aceita somente se detectar um único rosto. Confira a prévia e clique em **Salvar cadastro local**. Capturar uma prévia não salva dados permanentemente. Você pode descartar ou capturar outra foto antes de salvar.

O cadastro guarda nome, foto recortada em JPEG e data no IndexedDB deste navegador. As fotos têm no máximo 480 pixels no maior lado e não incluem a sobreposição. Não são persistidos landmarks ou vetores de reconhecimento. O mesmo nome não pode ser salvo duas vezes, independentemente de maiúsculas/minúsculas. A aplicação não verifica se fotos com nomes diferentes pertencem à mesma pessoa.

Para melhorar a representação de uma pessoa, capture outra foto e clique em **Adicionar foto** ao lado do nome já cadastrado. A prévia será salva nesse cadastro, sem criar outra pessoa. Use de três a cinco fotos nítidas: de frente e com pequenas variações de posição e iluminação. O limite é de cinco fotos por cadastro. Fotos antigas continuam funcionando, mesmo com apenas uma referência; não é necessário excluí-las. Todas as fotos da pessoa são removidas juntas ao excluir o cadastro.

Os cadastros persistem ao recarregar e podem ser removidos pelo botão **Excluir**. Eles ficam associados ao navegador e ao endereço exato: `localhost:8000` e `127.0.0.1:8000` têm armazenamentos separados. Limpar os dados do site remove os cadastros; navegação privada pode não preservá-los. O cadastro não é sincronizado com GitHub ou outro dispositivo, não possui login próprio e pode ser visto por quem usa o mesmo perfil do navegador.

## Rodar localmente

Com Node.js 22.12+ ou 24 instalado, execute na pasta do projeto:

```sh
npm ci
npm start
```

Abra http://localhost:8000 e clique em **Iniciar câmera**. Os modelos são inicializados após a câmera começar. A interface mostra carregamento, detecção e comparação com os cadastros locais. Para encerrar o servidor, pressione Ctrl+C.

O primeiro `npm start` baixa o modelo oficial MediaPipe (aproximadamente 3,8 MB), valida seu SHA-256 e copia os arquivos WASM da versão instalada para `public/mediapipe/`. Também copia os manifestos, pesos SSD MobileNet/alinhamento/reconhecimento (aproximadamente 12,4 MB) e a licença do pacote FaceAPI para `public/recognition/`. As versões estão fixadas no lockfile. A internet é necessária para instalar dependências e preparar os recursos pela primeira vez. Inícios posteriores reutilizam o modelo local validado. Os recursos gerados não entram no controle de versão; `npm run assets` pode prepará-los manualmente. Use Vite para servir os fontes com imports npm.

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

Com o servidor ativo, `npm run test:browser` executa QA no Edge/Chrome instalado (ou no executável indicado por `BROWSER_BINARY`), usando vídeo de teste e retratos públicos oficiais do MediaPipe. O script verifica inferência real, reconhecimento de uma referência cadastrada, segunda foto com brilho reduzido, rejeição de outra pessoa como acesso negado/desconhecido, sobreposição, viewport móvel, cancelamento e cadastro com persistência/exclusão. Usa um perfil temporário, sem acessar sua câmera física ou seus cadastros. Os testes positivos usam recortes e brilho diferentes da mesma imagem; verificam integração e regressões, sem medir acurácia com pessoas reais em condições variadas. Para testar outro endereço: `npm run test:browser -- http://127.0.0.1:8001`.

## Arquitetura

- `src/camera.js`: solicita câmera frontal por preferência, permite selecionar dispositivo e encerra todas as faixas. Descarta streams recebidos após cancelar uma solicitação pendente.
- `src/analysis.js`: único agendador, com `requestVideoFrameCallback` e fallback para `requestAnimationFrame`. Limita o processamento a até 15 FPS, evita repetir quadros, aguarda inferências pendentes e descarta resultados de sessões encerradas.
- `src/integration.js`: adaptador com `initialize`, `detect`, `draw` e `close`. Transfere `ImageBitmap` temporário para o worker, trata timeout e rejeita solicitações pendentes ao encerrar.
- `src/face-worker.js`: inicializa o Face Landmarker em modo `VIDEO` com execução CPU, roda inferências fora da interface e fecha cada bitmap. O runtime WASM usa formato módulo ES, compatível com o worker. Terminar o worker libera modelo e memória WASM.
- `src/overlay.js`: desenha contornos retornados pelo modelo, em coordenadas nativas do vídeo. Vídeo e canvas usam `object-fit: contain` e são espelhados juntos quando a câmera informa orientação frontal.
- `src/app.js`: coordena captura, carregamento, resultados e erro de análise. Falhar na análise mantém a câmera controlável. `dispose()` encerra captura e worker ao sair; também pode ser usado na desmontagem de um componente.
- `src/enrollment.js`: modo de cadastro, captura de um quadro congelado, nova inferência desse quadro, recorte, prévia, salvamento e exclusão. A captura é descartada se a câmera for interrompida durante o processo.
- `src/face-store.js`: persistência local de nome e foto no IndexedDB, com validação de nome e índice único. Erros de armazenamento são informados sem interromper a câmera.
- `src/recognition.js`: preparação dos cadastros, comparação ao vivo, estados da interface e invalidação de resultados após parar ou atualizar a lista.
- `src/recognition-adapter.js` e `src/recognition-worker.js`: comunicação com um worker FaceAPI, detecção/alinhamento e extração de descritores. Quadros e modelo ficam no dispositivo.
- `src/face-matching.js`: rejeição de desconhecidos, margem entre candidatos e três leituras consecutivas antes de exibir um nome.

## Recursos e privacidade

O vídeo, os quadros e os descritores de reconhecimento ficam na memória do navegador/worker e são liberados após uso. Somente clicar em **Salvar cadastro local** persiste o nome e a foto selecionada no IndexedDB. As imagens e descritores não são enviados a um servidor. Modelos, pesos e WASM são servidos pelo mesmo servidor da página, sem CDN em tempo de captura. A interface informa a gravação local antes do salvamento e oferece exclusão individual.

A [documentação de privacidade do pacote oficial](https://www.npmjs.com/package/@mediapipe/tasks-vision) informa que MediaPipe processa as entradas no dispositivo e pode enviar métricas técnicas de uso/desempenho ao Google; essas métricas são distintas das imagens. Servir os recursos localmente não garante ausência total de telemetria da biblioteca. Revise essa política antes de disponibilizar o produto a usuários.

Modelo: [Face Landmarker float16, revisão 1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task). SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`. Referência: [guia oficial para Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

Reconhecimento: [guia do FaceAPI](https://github.com/vladmandic/face-api/blob/master/TUTORIAL.md) e [licença MIT](https://github.com/vladmandic/face-api/blob/master/LICENSE). A biblioteca usa uma rede de descritores faciais, independente dos landmarks MediaPipe. O repositório do fornecedor foi arquivado em fevereiro de 2025; esta integração fixa a versão 1.7.15. Reavalie manutenção, desempenho e acurácia antes de usar em produção.

## Autenticação futura

**Reconhecimento visual não é autenticação segura.** Esta versão compara rostos localmente e exibe correspondências experimentais. Fotos/vídeos podem corresponder; não há prova de vivacidade, sessão autenticada, autorização no servidor ou proteção contra adulteração do JavaScript. Para controle de acesso real, faltam calibração com dados representativos, proteção contra apresentação de fotos/vídeos e gestão segura de sessões e autorização. MediaPipe fornece os contornos; FaceAPI fornece os descritores comparados. Nenhum resultado desta demonstração libera acesso.
