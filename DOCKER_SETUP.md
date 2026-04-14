# Sistema Mecânica - Docker Setup

## Pré-requisitos

- Docker instalado ([download aqui](https://www.docker.com/products/docker-desktop))
- Docker Compose (geralmente vem com Docker Desktop)

## Como usar

### Opção 1: Com Docker Compose (Recomendado)

1. Abra o terminal na pasta do projeto
2. Execute:

```bash
docker-compose up --build
```

3. Acesse a aplicação em: `http://localhost:5000`

4. Para parar: `Ctrl+C` ou `docker-compose down`

### Opção 2: Sem Docker Compose

1. Build da imagem:
```bash
docker build -t sistema-mecanica .
```

2. Execute o container:
```bash
docker run -p 5000:5000 -v %cd%/screen:/app/screen sistema-mecanica
```

No Linux/Mac: `$(pwd)` ao invés de `%cd%`

3. Acesse em: `http://localhost:5000`

## Estrutura

```
Sistema_Mecânica/
├── app.py
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .dockerignore
├── static/
├── templates/
└── screen/              (criada automaticamente)
```

## Volumes (Dados Persistentes)

Os arquivos salvos (PDFs, configurações) ficam em `./screen/` no seu computador e são sincronizados com o container.

## Troubleshooting

**Porta 5000 já está em uso:**
```bash
# Mude no docker-compose.yml:
ports:
  - "8000:5000"  # Acesse em http://localhost:8000
```

**Permissões de pasta `screen:`**
```bash
docker-compose down
# Remova a pasta screen
rm -r screen
docker-compose up --build
```

**Ver logs:**
```bash
docker-compose logs -f
```
