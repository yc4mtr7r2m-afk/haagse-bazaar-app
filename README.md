# Haagse Bazaar mobiele bestelapp

Expo + React Native app voor iPhone en Android met Shopify-producten en winkelwagen, gebaseerd op de winkel `haagse-bazaar.myshopify.com`.

**Status:** alleen broncode. Deze versie is niet op een telefoon geïnstalleerd of end-to-end getest. De Shopify Storefront API-verbinding en checkout moeten eerst getest worden voordat klanten kunnen bestellen.

## Gebruik

- Bekijk en zoek Shopify-producten
- Bekijk productbeschrijvingen en kies beschikbare varianten
- Voeg toe aan de Shopify-winkelwagen, pas aantallen aan
- Open Shopify Checkout voor betaling

## Starten

```sh
npm install
npx expo start
```

## Beveiliging

Deze repository bevat **geen API-token of wachtwoord**. De app probeert de publieke, tokenloze Shopify Storefront API. Wanneer Shopify voor de gekozen toegang een publiek Headless Storefront-token nodig heeft, configureer dan `EXPO_PUBLIC_SHOPIFY_STOREFRONT_TOKEN` als omgevingvariabele in de bouwomgeving. Dit mag uitsluitend een *publiek* storefront-token zijn, nooit een `shpat_` private token of Shopify Admin token. Expo `EXPO_PUBLIC_` variabelen worden opgenomen in de app.

## Distributie

Voor build via EAS moet het project worden gekoppeld aan Expo en geconfigureerd. Op een echte iPhone is registratie/TestFlight/Apple Developer vereist voor native distributie. Controleer ook de officiële vereisten van Apple en Google Play.
