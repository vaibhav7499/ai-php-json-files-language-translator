FROM node:20

WORKDIR /app

RUN apt-get update && apt-get install -yqq \
    mc \
    nano -qyy

COPY app/package*.json ./
RUN npm install

COPY . .                             
EXPOSE 3000
