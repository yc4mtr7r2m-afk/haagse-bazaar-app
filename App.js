import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SHOP = 'haagse-bazaar.myshopify.com';
const API = `https://${SHOP}/api/2026-07/graphql.json`;
const CART_KEY = 'haagse-bazaar-cart-id';
const PUBLIC_TOKEN = process.env.EXPO_PUBLIC_SHOPIFY_STOREFRONT_TOKEN || '';
const formatPrice = (price) => {
  if (!price) return 'Prijs op aanvraag';
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: price.currencyCode || 'EUR' }).format(Number(price.amount));
};

async function storefront(query, variables = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PUBLIC_TOKEN ? { 'X-Shopify-Storefront-Access-Token': PUBLIC_TOKEN } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error(`Shopify geeft geen geldige reactie (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(payload.errors?.[0]?.message || `Shopify weigert de aanvraag (HTTP ${response.status}).`);
    if (payload.errors?.length) throw new Error(payload.errors.map((x) => x.message).join('; '));
    if (!payload.data) throw new Error('Shopify heeft geen gegevens teruggestuurd.');
    return payload.data;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('De Shopify-verbinding duurt te lang. Probeer opnieuw.');
    if (e instanceof TypeError) throw new Error('Kan Shopify niet bereiken. Controleer de internetverbinding.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

const PRODUCTS = `query($term:String){products(first:40,query:$term){nodes{id title description featuredImage{url altText} priceRange{minVariantPrice{amount currencyCode}}}}}`;
const PRODUCT = `query($id:ID!){product(id:$id){id title description featuredImage{url altText} variants(first:60){nodes{id title availableForSale price{amount currencyCode}}}}}`;
const CART_FIELDS = `id checkoutUrl totalQuantity cost{subtotalAmount{amount currencyCode}} lines(first:60){nodes{id quantity merchandise{... on ProductVariant{id title price{amount currencyCode} product{title}}}}}`;
const READ_CART = `query($id:ID!){cart(id:$id){${CART_FIELDS}}}`;
const CREATE_CART = `mutation($variant:ID!){cartCreate(input:{lines:[{merchandiseId:$variant,quantity:1}]}){cart{${CART_FIELDS}} userErrors{message}}}`;
const ADD_LINE = `mutation($id:ID!,$variant:ID!){cartLinesAdd(cartId:$id,lines:[{merchandiseId:$variant,quantity:1}]){cart{${CART_FIELDS}} userErrors{message}}}`;
const UPDATE_LINE = `mutation($id:ID!,$line:ID!,$quantity:Int!){cartLinesUpdate(cartId:$id,lines:[{id:$line,quantity:$quantity}]){cart{${CART_FIELDS}} userErrors{message}}}`;
const REMOVE_LINE = `mutation($id:ID!,$line:ID!){cartLinesRemove(cartId:$id,lineIds:[$line]){cart{${CART_FIELDS}} userErrors{message}}}`;
function getValidCart(mutation) {
  if (mutation?.userErrors?.length) throw new Error(mutation.userErrors.map((x) => x.message).join('; '));
  if (!mutation?.cart) throw new Error('Shopify heeft geen winkelwagen teruggegeven.');
  return mutation.cart;
}

function Button({ title, onPress, disabled, secondary, style }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled, style]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}
function Store() {
  const [screen, setScreen] = useState('products');
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState(null);
  const [variant, setVariant] = useState('');
  const [cart, setCart] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action) {
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e?.message || 'Er is iets misgegaan.'); }
    finally { setBusy(false); }
  }
  async function loadProducts(term = '') {
    await run(async () => {
      const data = await storefront(PRODUCTS, { term: term.trim() || null });
      setProducts(data.products?.nodes || []);
      setScreen('products');
    });
  }
  useEffect(() => {
    loadProducts();
    AsyncStorage.getItem(CART_KEY).then(async (id) => {
      if (!id) return;
      try {
        const data = await storefront(READ_CART, { id });
        if (data.cart) setCart(data.cart);
        else await AsyncStorage.removeItem(CART_KEY);
      } catch { /* de app blijft bruikbaar wanneer een oude cart ontbreekt */ }
    }).catch(() => {});
  }, []);
  async function openProduct(id) {
    await run(async () => {
      const data = await storefront(PRODUCT, { id });
      if (!data.product) throw new Error('Dit product is niet meer beschikbaar.');
      setProduct(data.product);
      setVariant(data.product.variants?.nodes?.find((v) => v.availableForSale)?.id || '');
      setScreen('detail');
    });
  }
  async function saveCart(next) {
    setCart(next);
    await AsyncStorage.setItem(CART_KEY, next.id);
  }
  async function addProduct() {
    if (!variant) return;
    await run(async () => {
      const result = cart?.id
        ? await storefront(ADD_LINE, { id: cart.id, variant })
        : await storefront(CREATE_CART, { variant });
      await saveCart(getValidCart(cart?.id ? result.cartLinesAdd : result.cartCreate));
      setScreen('cart');
    });
  }
  async function changeQuantity(line, quantity) {
    if (!cart) return;
    await run(async () => {
      const result = quantity > 0
        ? await storefront(UPDATE_LINE, { id: cart.id, line: line.id, quantity })
        : await storefront(REMOVE_LINE, { id: cart.id, line: line.id });
      await saveCart(getValidCart(quantity > 0 ? result.cartLinesUpdate : result.cartLinesRemove));
    });
  }
  function checkout() {
    if (!cart?.checkoutUrl) return setError('Geen Shopify-afrekenlink beschikbaar.');
    Linking.openURL(cart.checkoutUrl).catch(() => setError('De afrekenpagina kon niet worden geopend.'));
  }
  const lines = cart?.lines?.nodes || [];
  return <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
    <StatusBar barStyle="light-content" backgroundColor="#164b39" />
    <View style={styles.header}>
      <Text style={styles.logo}>HB</Text>
      <View style={{ flex: 1 }}><Text style={styles.brand}>HAAGSE BAZAAR</Text><Text style={styles.subtitle}>Jouw winkel, eenvoudig besteld</Text></View>
      <Pressable onPress={() => setScreen('cart')}><Text style={styles.cartCount}>🛍️ {cart?.totalQuantity || 0}</Text></Pressable>
    </View>
    {error ? <View style={styles.alert}><Text style={styles.alertText}>{error}</Text><Pressable onPress={() => setError('')}><Text style={styles.alertText}>✕</Text></Pressable></View> : null}
    {busy ? <View style={styles.loading}><ActivityIndicator color="#164b39"/><Text>Even laden…</Text></View> : null}
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {screen === 'products' && <>
        <View style={styles.hero}><Text style={styles.heroTitle}>Ontdek jouw favorieten</Text><Text style={styles.heroSubtitle}>Shop gemakkelijk bij Haagse Bazaar</Text></View>
        <View style={styles.searchRow}>
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => loadProducts(search)} placeholder="Zoek in de winkel…" returnKeyType="search" style={styles.input}/>
          <Button title="Zoek" disabled={busy} onPress={() => loadProducts(search)}/>
        </View>
        <View style={styles.headingRow}><Text style={styles.heading}>Onze producten</Text><Pressable onPress={() => loadProducts(search)}><Text style={styles.link}>Vernieuwen</Text></Pressable></View>
        <View style={styles.grid}>{products.map((p) => <Pressable key={p.id} onPress={() => openProduct(p.id)} style={styles.card}>
          {p.featuredImage?.url ? <Image source={{ uri: p.featuredImage.url }} style={styles.picture}/> : <View style={[styles.picture, styles.placeholder]}><Text style={{fontSize:35}}>🛍️</Text></View>}
          <View style={styles.cardText}><Text style={styles.productTitle} numberOfLines={2}>{p.title}</Text><Text style={styles.price}>{formatPrice(p.priceRange?.minVariantPrice)}</Text><Text style={styles.link}>Bekijk product →</Text></View>
        </Pressable>)}</View>
        {!busy && products.length === 0 ? <Text style={styles.note}>Geen producten gevonden. Controleer of de artikelen in Shopify zijn gepubliceerd voor Headless.</Text> : null}
        <Text style={styles.note}>Maximaal 40 producten per zoekopdracht in deze eerste versie.</Text>
      </>}
      {screen === 'detail' && product && <>
        <Button title="← Terug naar producten" secondary onPress={() => setScreen('products')}/>
        {product.featuredImage?.url ? <Image source={{ uri: product.featuredImage.url }} style={styles.bigPicture}/> : null}
        <Text style={styles.bigTitle}>{product.title}</Text>
        <Text style={styles.description}>{product.description}</Text>
        <Text style={styles.heading}>Kies een variant</Text>
        {(product.variants?.nodes || []).map((v) => <Pressable key={v.id} disabled={!v.availableForSale || busy} onPress={() => setVariant(v.id)} style={[styles.variant, variant === v.id && styles.selected, !v.availableForSale && styles.disabled]}>
          <View style={{flex:1}}><Text style={styles.productTitle}>{v.title}</Text><Text style={styles.note}>{v.availableForSale ? 'Op voorraad' : 'Uitverkocht'}</Text></View><Text style={styles.price}>{formatPrice(v.price)}</Text>
        </Pressable>)}
        <Button title="Toevoegen aan winkelwagen" onPress={addProduct} disabled={busy || !variant} style={{marginTop:12}}/>
      </>}
      {screen === 'cart' && <>
        <Text style={styles.heading}>Jouw winkelwagen</Text>
        {lines.length === 0 ? <View style={styles.empty}><Text style={{fontSize:50}}>🛒</Text><Text style={styles.note}>Je winkelwagen is nog leeg.</Text><Button title="Producten bekijken" onPress={() => setScreen('products')}/></View> : lines.map((l) => <View key={l.id} style={styles.cartItem}>
          <View style={{flex:1}}><Text style={styles.productTitle}>{l.merchandise?.product?.title}</Text><Text style={styles.note}>{l.merchandise?.title}</Text><Text style={styles.price}>{formatPrice(l.merchandise?.price)}</Text></View>
          <View style={styles.counter}><Pressable disabled={busy} onPress={() => changeQuantity(l, l.quantity - 1)} style={styles.quantityButton}><Text style={styles.quantityText}>−</Text></Pressable><Text style={styles.quantityText}>{l.quantity}</Text><Pressable disabled={busy} onPress={() => changeQuantity(l, l.quantity + 1)} style={styles.quantityButton}><Text style={styles.quantityText}>+</Text></Pressable></View>
        </View>)}
        {lines.length > 0 ? <View style={styles.summary}><Text style={styles.heading}>Subtotaal: {formatPrice(cart?.cost?.subtotalAmount)}</Text><Text style={styles.note}>Definitieve prijzen, verzendkosten en belastingen worden bij Shopify berekend.</Text><Button title="Veilig afrekenen via Shopify" onPress={checkout} style={{marginTop:10}}/><Text style={styles.note}>Afrekenen kan beperkt zijn zolang de webshop een wachtwoordpagina heeft.</Text></View> : null}
      </>}
    </ScrollView>
    <View style={styles.tabs}><Pressable style={styles.tab} onPress={() => setScreen('products')}><Text style={[styles.tabText, screen !== 'cart' && styles.active]}>⌂  Winkel</Text></Pressable><Pressable style={styles.tab} onPress={() => setScreen('cart')}><Text style={[styles.tabText, screen === 'cart' && styles.active]}>🛒  Winkelwagen</Text></Pressable></View>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Store/></SafeAreaProvider>; }

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:'#f7f9f5'},
  header:{backgroundColor:'#164b39',padding:17,flexDirection:'row',alignItems:'center',gap:10},
  logo:{color:'#164b39',backgroundColor:'#e8f2db',borderRadius:12,overflow:'hidden',fontSize:21,fontWeight:'900',textAlign:'center',paddingVertical:13,width:49},
  brand:{color:'white',fontWeight:'900',fontSize:17,letterSpacing:1},subtitle:{color:'#d0e4d6',fontSize:11,marginTop:3},cartCount:{color:'white',fontWeight:'800'},
  alert:{backgroundColor:'#fff0e9',padding:13,margin:12,borderRadius:10,flexDirection:'row',gap:10},alertText:{flex:1,color:'#973d32',fontSize:12},
  loading:{padding:10,flexDirection:'row',gap:10,alignItems:'center'},content:{padding:15,paddingBottom:28},
  hero:{borderRadius:17,backgroundColor:'#e3eedb',padding:23,marginBottom:18},heroTitle:{fontSize:25,fontWeight:'900',color:'#164b39'},heroSubtitle:{fontSize:13,color:'#5d7c64',marginTop:6},
  searchRow:{flexDirection:'row',gap:8,marginBottom:19},input:{borderColor:'#dce6dd',borderWidth:1,borderRadius:10,paddingHorizontal:12,backgroundColor:'white',flex:1},
  button:{backgroundColor:'#164b39',padding:13,borderRadius:10,alignItems:'center',justifyContent:'center'},buttonText:{color:'white',fontSize:13,fontWeight:'800'},secondaryButton:{backgroundColor:'#e8eee8',alignSelf:'flex-start'},secondaryText:{color:'#164b39'},disabled:{opacity:.4},
  headingRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},heading:{fontWeight:'900',fontSize:18,color:'#163d33',marginBottom:13},link:{fontSize:12,color:'#257455',fontWeight:'750'},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:10},card:{width:'48%',backgroundColor:'white',borderColor:'#e3e9e3',borderWidth:1,borderRadius:13,overflow:'hidden'},picture:{width:'100%',height:135},placeholder:{backgroundColor:'#edf2e9',justifyContent:'center',alignItems:'center'},cardText:{padding:11},productTitle:{fontSize:13,fontWeight:'800',color:'#194537'},price:{fontSize:15,fontWeight:'900',color:'#173d33',marginTop:8,marginBottom:8},note:{color:'#798b7e',fontSize:12,lineHeight:18,marginVertical:6},
  bigPicture:{width:'100%',height:270,borderRadius:14,backgroundColor:'#edf2e9',marginTop:13},bigTitle:{fontSize:24,fontWeight:'900',color:'#163d33',marginTop:16},description:{color:'#5f7465',lineHeight:21,fontSize:14,marginVertical:14},
  variant:{backgroundColor:'white',padding:13,borderRadius:11,borderWidth:1,borderColor:'#d9e6dc',flexDirection:'row',gap:9,alignItems:'center',marginBottom:9},selected:{borderColor:'#164b39',borderWidth:2,backgroundColor:'#eef5e9'},
  empty:{alignItems:'center',gap:12,padding:30},cartItem:{backgroundColor:'white',padding:13,borderRadius:12,flexDirection:'row',gap:10,marginBottom:10,borderWidth:1,borderColor:'#e0e8df',alignItems:'center'},counter:{flexDirection:'row',gap:9,alignItems:'center'},quantityButton:{backgroundColor:'#eaf2ea',padding:8,borderRadius:7},quantityText:{fontSize:16,fontWeight:'800',color:'#164b39'},summary:{backgroundColor:'white',padding:14,borderRadius:13,marginTop:12},
  tabs:{flexDirection:'row',padding:12,backgroundColor:'white',borderTopWidth:1,borderTopColor:'#e1e9e1'},tab:{flex:1,alignItems:'center'},tabText:{fontSize:14,fontWeight:'800',color:'#92a094'},active:{color:'#164b39'}
});
