# Docker Image Digest Pinning

Updated: 2026-05-19

Production compose pins public proxy images by immutable manifest digest:

| Service | Image |
|---|---|
| caddy | `caddy:2.8-alpine@sha256:af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17` |
| oauth2-proxy | `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine@sha256:36b46309c74e368e4b894314f5c69723c73728d60f66b777c13a40686a1364f7` |

Refresh flow:

```powershell
docker compose -f deploy/docker-compose.prod.yml pull
docker buildx imagetools inspect caddy:2.8-alpine
docker buildx imagetools inspect quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine
```

Update `deploy/docker-compose.prod.yml` only after reviewing upstream release notes.
