# Démo avec données fictives

Lance ColocOS en local avec **7 colocataires fictifs**, un frigo rempli, des dépenses et une liste de
courses, dans une base PostgreSQL séparée. Aucune donnée réelle : c'est ce qui a servi aux captures
du README.

```powershell
# 1. Base de démo (port 55434, séparée de la base de dev)
docker run -d --name colocos-demo-db -e POSTGRES_USER=colocos -e POSTGRES_PASSWORD=demo `
  -e POSTGRES_DB=colocos_demo -p 127.0.0.1:55434:5432 postgres:16-alpine

# 2. Dépendances + config de démo
npm install
copy demo\backend.env.demo apps\backend\.env

# 3. Schéma, colocs fictifs, front compilé
cd apps\backend
npx prisma db push
npm run db:seed
cd ..\frontend
npm run build
cd ..\..

# 4. API + front (ouvre deux fenêtres)
powershell -ExecutionPolicy Bypass -File demo\start-demo.ps1

# 5. Remplissage (une fois l'API démarrée)
node demo\populate.mjs
```

Ouvrir http://localhost:4173 et choisir le profil « Mattéo ».
