# Déploiement de Webinti Town sur VPS

Cible : `https://live.webinti.com` sur un VPS Ubuntu 22.04 LTS (ou 24.04), nginx déjà en place.

## Plan d'attaque

1. **Côté VPS** (une seule fois) : créer les users, installer Node + LiveKit, ouvrir les ports firewall, poser les configs nginx + systemd, certifier en HTTPS.
2. **Côté local** : `./deploy/deploy.sh` à chaque redéploiement (build + rsync + restart).

## 1. Préparation du VPS (one-shot)

### 1.0. Cloner le repo sur le VPS

C'est juste pour avoir les configs (`nginx.conf`, `livekit.prod.yaml`, units systemd) à portée de main. Le code source qui tourne en prod, lui, sera envoyé via `deploy.sh` plus tard.

```bash
ssh root@live.webinti.com  # ou avec ton user sudo habituel
sudo apt-get update && sudo apt-get install -y git
cd ~
git clone https://github.com/webinti/webinti-town.git
cd webinti-town
```

À partir d'ici, toutes les commandes `cp deploy/...` du guide partent du principe que tu es dans `~/webinti-town/`.

### 1.1. Utilisateurs système

```bash
sudo useradd -r -m -d /var/www/webinti-town -s /bin/bash webinti
sudo useradd -r -M -d /nonexistent -s /usr/sbin/nologin livekit
sudo mkdir -p /var/www/webinti-town/{client,server}
sudo chown -R webinti:webinti /var/www/webinti-town
```

### 1.2. Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # v20.x
```

### 1.3. LiveKit Server (binaire natif)

```bash
# Téléchargement de la dernière release Linux amd64
LK_VER=$(curl -s https://api.github.com/repos/livekit/livekit/releases/latest | grep tag_name | cut -d '"' -f 4)
curl -L -o /tmp/livekit.tar.gz "https://github.com/livekit/livekit/releases/download/${LK_VER}/livekit_${LK_VER#v}_linux_amd64.tar.gz"
sudo tar -xzf /tmp/livekit.tar.gz -C /usr/local/bin livekit-server
sudo chmod +x /usr/local/bin/livekit-server
livekit-server --version
```

### 1.4. Config LiveKit

```bash
# Génère le secret API
LK_SECRET=$(openssl rand -hex 32)
echo "LiveKit secret (note pour plus tard) : $LK_SECRET"

sudo mkdir -p /etc/livekit
sudo cp deploy/livekit.prod.yaml /etc/livekit/livekit.yaml
sudo sed -i "s|<changeme-32-chars-min>|$LK_SECRET|" /etc/livekit/livekit.yaml
sudo chown root:livekit /etc/livekit/livekit.yaml
sudo chmod 640 /etc/livekit/livekit.yaml
```

### 1.5. Pare-feu (UFW)

```bash
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP (redirigé vers HTTPS)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw allow 7881/tcp      # LiveKit TCP fallback
sudo ufw allow 50000:60000/udp  # LiveKit RTC UDP range
sudo ufw enable
```

### 1.6. Services systemd

```bash
sudo cp deploy/webinti-server.service /etc/systemd/system/
sudo cp deploy/livekit-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable livekit-server
# Le service webinti-server démarrera après le premier déploiement (besoin de dist/)
```

Lancer LiveKit dès maintenant :

```bash
sudo systemctl start livekit-server
sudo journalctl -u livekit-server -f  # vérifier
```

### 1.7. nginx vhost

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/webinti-town
sudo ln -s /etc/nginx/sites-available/webinti-town /etc/nginx/sites-enabled/
sudo nginx -t
```

**Ne reload pas encore** — le cert n'existe pas. Génère-le d'abord :

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d live.webinti.com
# Suis le prompt (email, accepter les TOS). Certbot modifie nginx.conf et reload.
```

À ce point `https://live.webinti.com` répond mais sert un placeholder (rien dans `/var/www/webinti-town/client/` encore).

### 1.8. Fichier `.env` serveur

```bash
sudo cp deploy/.env.example /var/www/webinti-town/.env
sudo nano /var/www/webinti-town/.env
```

À remplir :
- `LIVEKIT_API_SECRET` = le `LK_SECRET` généré à l'étape 1.4 (doit matcher livekit.yaml)
- `HOST_TOKEN` = `openssl rand -hex 24` (note-le, ce sera ton URL d'hôte)
- `CLIENT_ORIGIN=https://live.webinti.com`
- `LIVEKIT_URL=wss://live.webinti.com/livekit`

```bash
sudo chown webinti:webinti /var/www/webinti-town/.env
sudo chmod 600 /var/www/webinti-town/.env
```

### 1.9. Permettre à webinti-server de redémarrer via sudo (pour le script deploy.sh)

Optionnel mais pratique :

```bash
echo 'webinti ALL=(root) NOPASSWD: /bin/systemctl restart webinti-server' | sudo tee /etc/sudoers.d/webinti-restart
sudo chmod 440 /etc/sudoers.d/webinti-restart
```

## 2. Premier déploiement (depuis ton Mac)

Configure ton SSH pour pouvoir te connecter en `tim@VPS` (ou un autre user qui peut écrire dans `/var/www/webinti-town/`). Le plus simple : SSH en tant que `webinti` directement (ajoute ta clé publique à `/var/www/webinti-town/.ssh/authorized_keys`).

```bash
# Sur le VPS, une fois :
sudo -u webinti mkdir -p /var/www/webinti-town/.ssh
sudo -u webinti tee /var/www/webinti-town/.ssh/authorized_keys < ~/.ssh/authorized_keys  # ou colle ta clé pub
sudo chmod 700 /var/www/webinti-town/.ssh
sudo chmod 600 /var/www/webinti-town/.ssh/authorized_keys
```

Test : `ssh webinti@live.webinti.com 'whoami'` doit afficher `webinti`.

### Lancer le déploiement

```bash
# Sur ton Mac, à la racine du projet
export WEBINTI_HOST=webinti@live.webinti.com
./deploy/deploy.sh
```

Le script :
1. Build le client en mode prod (Vite → `client/dist/`)
2. Build le serveur (tsc → `server/dist/`)
3. rsync `client/dist/` → `/var/www/webinti-town/client/`
4. rsync `server/dist/` + `package.json` → `/var/www/webinti-town/server/`
5. `npm ci --omit=dev` sur le VPS pour installer les deps prod uniquement
6. `systemctl restart webinti-server`

Vérifie :

```bash
ssh webinti@live.webinti.com 'sudo systemctl status webinti-server'
ssh webinti@live.webinti.com 'journalctl -u webinti-server -n 30'
```

Si tu vois `[webintispace] listening on http://localhost:3001` → ça tourne.

## 3. Premier test

Ouvre `https://live.webinti.com/?host=<HOST_TOKEN>` dans Chrome → tu dois voir l'écran d'accueil. Rejoins → tu dois être hôte (pill orange).

Si la cam/micro ne s'active pas : check la console navigateur. C'est probablement un `getUserMedia` qui exige HTTPS — vérifie que le cert est bien servi.

Si LiveKit ne se connecte pas : `journalctl -u livekit-server -n 50`. Vérifie que `use_external_ip: true` fonctionne (sinon mets `node_ip: <IP_PUBLIQUE_VPS>` à la place dans `livekit.yaml`).

## 4. Redéploiements (la commande à retenir)

**À chaque fois que du nouveau code est mergé sur `main`** (nouvelles features, fix, map éditée via Tiled), pour le mettre en ligne sur `live.webinti.com` :

```bash
cd ~/Documents/Claude/Gather
git pull origin main                          # récupérer le dernier code
export WEBINTI_HOST=webinti@live.webinti.com  # ton user@host SSH (mets-le dans ~/.zshrc pour pas le retaper)
./deploy/deploy.sh
```

Ce que `deploy.sh` fait :
1. `npm ci` + build client (Vite prod → `client/dist/`)
2. `npm ci` + build serveur (`tsc` → `server/dist/`)
3. rsync `client/dist/` → `/var/www/webinti-town/client/`
4. rsync `server/dist/` + `package.json` → `/var/www/webinti-town/server/`
5. `npm ci --omit=dev` sur le VPS (deps prod only)
6. `sudo systemctl restart webinti-server`

La map `.tmj` éditée localement via Tiled part automatiquement dans le build (Vite copie `client/public/` → `dist/`).

> ⚠️ **Important** : tant que tu n'as pas relancé `./deploy/deploy.sh`, la version en ligne reste figée sur le dernier déploiement — même si tu as pushé sur GitHub. Push ≠ déploiement.

### Vérifier que le déploiement a pris

```bash
ssh $WEBINTI_HOST 'journalctl -u webinti-server -n 20 --no-pager'
# doit afficher un redémarrage récent + "listening on http://localhost:3001"
```

Puis recharge `https://live.webinti.com` en navigation privée (Cmd+Shift+R) pour éviter le cache.

### LiveKit n'a PAS besoin d'être redéployé

Le binaire LiveKit tourne en service systemd indépendant. `deploy.sh` ne le touche pas. Tu ne le redémarres que si tu changes `livekit.yaml` ou que tu mets à jour le binaire :

```bash
ssh $WEBINTI_HOST 'sudo systemctl restart livekit-server'
```

## 5. Caveats / production

- **Persistence** : aucune. Restart du Node = rooms/chats/whiteboards perdus. Pour un live, démarre le service le matin et laisse-le tourner.
- **Backup** : le seul état persistant est les fichiers dans `/var/www/webinti-town/` (code) et `.env` (secrets). `tar` mensuel suffit.
- **Logs** : `journalctl -u webinti-server` / `journalctl -u livekit-server`. Aucune rotation custom à ajouter, systemd-journald gère.
- **TURN** : si un participant a un réseau corporate très strict (UDP bloqué + TCP 7881 bloqué), il n'aura pas d'A/V. Solution : LiveKit Cloud (offre gratuite TURN), ou héberger coturn. Hors scope ici.
- **Mises à jour LiveKit** : tous les 2-3 mois, re-télécharger la dernière release et restart le service. Les API restent compatibles.
- **Sécurité** : le port 3001 (Node) et 7880 (LiveKit) sont écoutés sur 127.0.0.1 uniquement après le setup, donc pas exposés directement. nginx en HTTPS est le seul point d'entrée.
- **Multi-instance** : pas supporté — l'état est in-memory, donc un seul process Node à la fois. Pour scaler, il faudra Redis + Postgres (gros chantier).

## 6. Debug rapide

| Symptôme | Check |
|---|---|
| Page blanche | `ls /var/www/webinti-town/client/` doit avoir `index.html` |
| 502 sur `/socket.io/` | `systemctl status webinti-server` |
| `[join_error] Room not found` | Vérifier le slug correspond à `/^[a-z0-9-]{1,50}$/` |
| Mic/cam refusés | Console : permission denied → c'est Chrome qui bloque, pas l'app |
| LiveKit timeout | UDP 50000-60000 ouvert ? `sudo ufw status` |
| Token endpoint 500 | `LIVEKIT_API_SECRET` dans `.env` matche `livekit.yaml` ? |
