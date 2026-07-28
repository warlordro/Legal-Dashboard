# Legal Dashboard — ingress dedicat pentru Personal Access Tokens (NAS).
#
# De ce exista: pe stack-ul NAS tot traficul intra prin oauth2-proxy, care
# redirecteaza orice cerere fara sesiune Google catre login (302). Un client
# programatic cu `Authorization: Bearer ld_pat_*` nu ajunge niciodata la backend,
# deci API-ul PAT (v2.40.0) e inaccesibil din afara. Sidecar-ul asta e echivalentul
# rutei `@pat` din deploy/Caddyfile (stack-ul VPS + Caddy), adaptat pentru NAS.
#
# NU se poate rezolva prin OAUTH2_PROXY_SKIP_AUTH_ROUTES: cu PASS_BASIC_AUTH=true
# headerul `Authorization` al clientului nu supravietuieste trecerii prin oauth2-proxy
# (fie e suprascris de Basic-ul bridge-ului, fie e sters ca header injectabil pe o ruta
# fara sesiune — mecanismul exact NU e verificat empiric, rezultatul e acelasi). In plus,
# skip-auth-routes ar deschide `/api/*` pentru ORICE client, fara filtrul pe token.
#
# Multi-Authorization (asumptie pin-uita, mostenita din ruta @pat a stackului VPS):
# matcher-ul trece daca ORICARE valoare se potriveste, dar Node pastreaza doar PRIMA
# valoare de `Authorization`. O pereche `Basic x` + `Bearer ld_pat_y` ajunge la backend
# ca `Basic x` -> fara Bearer -> 401. Fail-closed; nu te baza pe merge-ul de headere.
#
# Layout: internet → Cloudflare (TLS) → cloudflared → caddy-pat (4181) → backend (3002)
# Hostname separat de cel de browser; pe hostname-ul de browser poarta Google ramane
# neschimbata.

{
	# Cloudflare termina TLS; tunelul livreaza plain HTTP pe 4181. Fara asta Caddy
	# ar incerca sa emita certificate pentru un host care nu-i apartine.
	auto_https off
	admin off
}

:4181 {
	encode zstd gzip

	# Ruta PAT: DOAR cereri cu token opac, pe /api/*, niciodata pe /api/v1/auth/*.
	# Exclusia de path e SECURITY-CRITICAL, nu igiena: bridge-ul /api/v1/auth/oauth2/sync
	# are incredere in headerele de identitate dupa verificarea secretului partajat, iar
	# traficul PAT nu are voie sa-l atinga direct.
	@pat {
		header Authorization "Bearer ld_pat_*"
		path /api/*
		not path /api/v1/auth/*
	}

	handle @pat {
		reverse_proxy backend:3002 {
			# Al doilea strat de aparare: nimic identity-shaped venit de la client nu
			# ajunge la backend. Pe calea PAT autentificarea e DOAR tokenul Bearer.
			header_up -Cookie
			header_up -X-Auth-Request-Email
			header_up -X-Auth-Request-User
			header_up -X-Auth-Request-Groups
			header_up -X-Forwarded-Email
			header_up -X-Forwarded-User
			header_up -X-Forwarded-Preferred-Username
			header_up -X-Proxy-Auth

			header_up Host {host}

			# OBLIGATORIU: backend-ul ruleaza cu NODE_ENV=production, deci patSecurity
			# respinge cu 426 orice PAT care nu vine cu x-forwarded-proto: https. TLS-ul
			# real e terminat de Cloudflare. Forma fara prefix SETEAZA (inlocuieste), deci
			# o valoare trimisa de client e suprascrisa, nu concatenata.
			header_up X-Forwarded-Proto https

			# NU stripui CF-Connecting-IP: e singura sursa de IP real de client dupa
			# lantul Cloudflare → cloudflared (readClientIp o prefera in fata XFF, o
			# citeste doar cand peer-ul e in LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR, iar
			# containerul asta e in 172.16.0.0/12). Fara ea, rate-limitul per token si
			# alerta de IP nou colapseaza pe o singura adresa.
		}
	}

	# Fara fallback explicit, Caddy raspunde 200 gol pe orice altceva. Un browser care
	# nimereste hostname-ul de API trebuie sa primeasca 404, nu o pagina goala.
	handle {
		respond 404
	}

	log {
		output stdout
		format json
	}
}
