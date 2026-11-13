# ColocOS — passerelle balance Xiaomi Mi Body Composition Scale 2

Deux implémentations pour la même balance `XMTZC05HM` (service GATT `0x181B`) :

| Cible | Fichier | Usage |
|---|---|---|
| Raspberry Pi 4 (tests immédiats) | `scale_bridge.py` | scan BLE continu + envoi HTTP |
| ESP32-WROOM-32 (production) | `esphome-scale.yaml` | firmware ESPHome autonome |

---

## 1. Raspberry Pi 4

```bash
# dépendances système
sudo apt update && sudo apt install -y python3-venv bluetooth bluez

# projet
cd ~/ColocOS/scripts/ble-scale
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# configuration
cp .env.example .env
nano .env          # COLOCOS_API_URL, COLOCOS_DEVICE_KEY, SCALE_MAC_ADDRESS…

# test à blanc, sans balance (valide toute la chaîne HTTP + BIA)
.venv/bin/python scale_bridge.py --simulate 73.8 475

# écoute réelle (Ctrl+C pour arrêter)
.venv/bin/python scale_bridge.py --scan

# service permanent
sudo cp colocos-scale.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now colocos-scale
journalctl -u colocos-scale -f
```

> Le scan BLE exige un utilisateur membre du groupe `bluetooth` :
> `sudo usermod -aG bluetooth pi`.

### Décodage des trames

13 octets little endian :

| Champ | Bits / octets | Détail |
|---|---|---|
| `ctrl` | `data[0:2]` | champ de contrôle |
| impédance présente | bit 9 (`0x0200`) | `data[9:11]` en Ω |
| pesée stabilisée | bit 13 (`0x2000`) | trame finale |
| poids retiré | bit 15 (`0x8000`) | fin de pesée |
| poids | `data[11:13]` | `/ 200` → kg (× 0,4536 si lbs, × 0,5 si jin) |

Anti-rebond : les trames non stabilisées sont ignorées, et une même pesée
`(poids arrondi, impédance)` n'est renvoyée qu'une fois par fenêtre de 60 s.

---

## 2. ESP32 (ESPHome)

```bash
pip install esphome
cd scripts/ble-scale

# secrets.yaml
cat > secrets.yaml <<'YAML'
wifi_ssid: "MonWifi"
wifi_password: "motdepasse"
ota_password: "ota-secret"
scale_mac: "AA:BB:CC:DD:EE:FF"
colocos_weigh_in_url: "http://192.168.1.20/api/profile/weigh-in"
colocos_device_key: "colocos_scale_device_key"
YAML

esphome run esphome-scale.yaml     # compile + flashe en USB
esphome logs esphome-scale.yaml    # vérifie les trames reçues
```

Le firmware interroge le capteur toutes les 30 s et poste la pesée dès que
poids (> 20 kg) et impédance sont disponibles.

---

## 3. Côté API

`POST /api/profile/weigh-in`, protégé par le header `X-Device-Key`
(`SCALE_DEVICE_KEY` dans `.env` / `docker-compose.yml`) :

```json
{ "weightKg": 73.8, "impedanceOhm": 475, "userId": "optionnel" }
```

Sans `userId`, la pesée est attribuée au profil dont le poids est le plus proche
(±3 kg, 422 si ambigu). L'impédance doit être dans **300–1200 Ω** pour que la
composition corporelle soit calculée (équation Xiaomi) ; hors plage, la pesée
est rejetée avec un message explicite.
