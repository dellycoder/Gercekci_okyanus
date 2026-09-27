# Gerçekçi Okyanus

Tarayıcıda gerçek zamanlı çalışan, fizik tabanlı bir okyanus simülasyonu. WebGL2 ve three.js ile yazıldı; kurulum veya derleme gerektirmez.

## Özellikler

**Dalgalar**
- GPU üzerinde FFT (Tessendorf) ile hesaplanan okyanus: JONSWAP spektrumu, Donelan-Banner yönsel yayılımı ve ayrı bir soluğan (swell) bileşeni
- 3 kademeli (600 m / 80 m / 13 m) dalga alanı sayesinde tekrar eden desen görünmez; 10 cm'lik kılcal dalgalardan 300 m'lik soluğanlara kadar her ölçek var
- Yatay yer değiştirme ile sivri dalga tepeleri, Jacobian tabanlı köpük birikimi ve sönümü
- Kameraya bağlı, merkezde 5 cm'ye kadar sıklaşan radyal ızgara ve ufka kadar uzanan dünya eğriliği
- Belirgin dalga yüksekliği (Hs), spektrumdan sayısal olarak hesaplanır ve ekranda gösterilir

**Gökyüzü ve ışık**
- Rayleigh, Mie ve ozon içeren fiziksel atmosferik saçılım: mavi gökyüzü, turuncu gün batımı, mavi saat
- Güneş ve Ay konumları seçilen **konum, tarih ve saate** göre astronomik olarak hesaplanır
- Ay'ın evresi gerçek Güneş yönünden gelir (hilal, dördün, dolunay)
- Gece gökyüzü: gerçek gök küresiyle dönen yıldızlar, Samanyolu, yıldız pırıltısı ve gece görüşünde mavimsi kayma
- Hareketli bulutlar, bulutların denize düşen gölgeleri, rüzgârla sürüklenme
- Güneş ve Ay ışığının su üzerinde parıltı yolu (GGX yansıma), Fresnel, su içi ışık geçirgenliği (SSS)

**Su altı**
- Snell penceresi ve tam iç yansıma
- Dalga dalga hareket eden kostikler, hacimsel ışık huzmeleri (god rays)
- Derinliğe ve dalga boyuna bağlı renk soğurması, deniz tabanı (kum dalgaları, deniz çayırı), süzülen partiküller
- Yarı su üstü / yarı su altı görüntü ve su çizgisi (menisküs)

**Hava durumu:** sakin, esintili, rüzgârlı, fırtına (yağmur, şimşek, gök gürültüsü), sisli

**Kamera modları**
- **Yüzme:** dalgalarla birlikte yükselip alçalırsınız; dalıp deniz tabanına inebilirsiniz
- **Havadan:** 2 km irtifaya kadar serbest drone uçuşu
- **Sinematik:** otomatik kamera turu

**Diğer:** prosedürel okyanus sesleri, yüzen şamandıra (gece yanıp söner), HDR, bloom, ACES ton eşleme, MSAA, çözünürlük ölçeği, 2x çözünürlükte ekran görüntüsü, ayarların tarayıcıda saklanması ve dokunmatik kontroller.

## Çalıştırma

ES modülleri kullanıldığı için dosyanın bir web sunucusundan açılması gerekir:

```bash
npx http-server -p 8080 .
# veya
python3 -m http.server 8080
```

Ardından tarayıcıda `http://localhost:8080` adresini açın. GitHub Pages üzerinde de doğrudan çalışır.

## Kontroller

| Tuş | İşlev |
| --- | --- |
| Fare sürükle | Etrafa bak (çift tık: fare kilidi) |
| W A S D / ok tuşları | Hareket |
| Boşluk / E | Yukarı, yüzeye çık |
| C / Q / Ctrl | Aşağı, dal |
| Shift | Hızlı |
| Fare tekerleği | Havadan modda irtifa, yüzmede hız |
| 1 · 2 · 3 | Yüzme · Havadan · Sinematik |
| T | Zaman akış hızını değiştir |
| [ ] | Saati 30 dk geri/ileri al |
| H | Arayüzü gizle |
| P | Ekran görüntüsü |
| F | Tam ekran |

## Grafik kalitesi

| Ön ayar | FFT | Izgara | Çözünürlük | MSAA |
| --- | --- | --- | --- | --- |
| Düşük | 128² | 260×256 | 0.75x | kapalı |
| Orta | 256² | 380×384 | 1x | kapalı |
| Yüksek | 256² | 560×576 | 1x | 4x |
| Ultra | 512² | 760×800 | 1.25x | 4x |

Güçlü bir ekran kartında "Ultra" ve 1.5 ile 2 arası çözünürlük ölçeğiyle süper örnekleme yapılabilir.

## Dosya yapısı

```
index.html              arayüz ve import map
style.css
src/main.js             döngü, ayarlar, arayüz
src/astro.js            Güneş/Ay/yıldız konumları
src/sky.js              atmosfer LUT'u, gökyüzü kubbesi, Ay diski
src/ocean/simulation.js GPU FFT dalga simülasyonu
src/ocean/surface.js    okyanus ızgarası ve su gölgelendiricisi
src/world.js            deniz tabanı, partiküller, yağmur, şamandıra
src/post.js             su altı, bloom, ton eşleme
src/controls.js         kamera modları
src/audio.js            prosedürel ses
src/shaders/common.js   ortak GLSL (gürültü, atmosfer, bulut, yıldız)
vendor/                 three.js r186, lil-gui (MIT)
```
