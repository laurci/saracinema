from node:14-alpine

run mkdir /app
workdir /app

copy package.json package.json
run yarn

copy . .
run yarn build

cmd ["npm", "start"]