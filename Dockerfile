# --- Estágio 1: Build ---
# Usamos uma imagem oficial do Node.js como base. A versão &#39;alpine&#39; é super leve.
# Especificamos a versão 18 para garantir consistência com o ambiente de desenvolvimento.
FROM node:18-alpine AS build

# Define o diretório de trabalho dentro do container para /app

WORKDIR /app

# Copia os arquivos de definição de pacotes primeiro.

# Isso é um truque de cache do Docker: se não mudarmos as dependências, ele não reinstala tudo.

COPY package\*.json ./

# Instala apenas as dependências de produção.

# 'npm ci' é mais rápido e seguro para produção do que 'npm install'.

RUN npm ci --omit=dev

# Copia todo o resto do código da nossa aplicação para dentro do container

COPY . .

# \--- Estágio 2: Production ---

# Começamos de novo com uma imagem base ainda mais leve para a versão final de produção

FROM node:18-alpine

WORKDIR /app

# Copia as dependências já instaladas do estágio de build

COPY --from=build /app/node\_modules ./node\_modules

# Copia o código da aplicação do estágio de build

COPY --from=build /app .

# Expõe a porta 3000, que é a que o nosso servidor Express usa

EXPOSE 3000

# O comando final que será executado quando o container iniciar para rodar o nosso app

CMD [ "node", "index.js" ]