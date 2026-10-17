# Darwin Konseyi · Jüri İçin

### "AL" demeden önce tartışan, gerektiğinde **"BEKLE"** diyen ve her kararını **Avalanche'ta** kanıtlayan AI analist konseyi.

**[▶ Canlı panel](https://darwin-council.vercel.app)** *(arayüz; canlı veri için bkz. "Canlı sistem neden yerelde?")* · **[▶ Sunum](https://darwin-council.vercel.app/pitch)** · **[Kod](https://github.com/yigitturaan/darwin-council)** · **[Soy ağacı kontratı (Snowtrace)](https://testnet.snowtrace.io/address/0xd75db90c8337a12de7293882b0251b0af78619dd)** · **[Karar kontratı (Snowtrace)](https://testnet.snowtrace.io/address/0x3cd8babe00dd10c08ebfc6435c1a41e6bde5a95a)**

![Darwin Konseyi](docs/darwin-council.svg)

> OKX TR × Team1 Agentic Hackathon · Ankara · 17 Ekim 2026
> Teknik ayrıntılar ve kurulum için İngilizce [README](README.md).

---

## 30 saniyede

- **Ne?** OKX TR canlı verisini dört uzman AI analistle inceleyip **AL / BEKLE / ENGELLE** kararı veren bir konsey. Kararı modelin sözü değil, koddaki sabit kurallar veriyor.
- **Kanıt:** Her karar sonuç belli olmadan **Avalanche'a mühürleniyor**. Sonradan değiştirilemiyor, silinemiyor.
- **Gerçek para:** Kendi **OKX TR alt hesabımız bağlı.** Konsey AL derse ve kullanıcı onaylarsa gerçek USDT, gerçek AVAX'a çevriliyor.
- **Evrim:** Analistler sürekli canlı sınavda. Zayıf olanın yerine bir "çırak" yetişiyor; geçemezse eleniyor. Bugün bu gerçekten oldu ve zincirde kayıtlı.

---

## Ahmet'in sorusu

Ahmet, OKX TR'de küçük bir AVAX alımı yapmak istiyor. Bir AI bot "AL! 🚀" diyor.

Peki hangi veriye baktı? Söylediği sayılar gerçek mi? Geçen hafta kaç kere yanıldı? Ya beklemesi gerekiyorsa?

Türkiye'de milyonlarca kripto kullanıcısı kararlarını sinyal gruplarına ve AI botlarına bırakıyor. Bunların hiçbiri neden dediğini, ne kadar yanıldığını ya da **"bekle"** demeyi göstermiyor. AI agent'lar kendi başına işlem yapmaya başladıkça bu, bir **güven ve güvenlik** sorununa dönüşüyor.

---

## Konsey

| Analist | Neye bakar |
|---|---|
| **Momentum** | Kısa vadeli fiyat hareketi |
| **Likidite** | Emir defteri derinliği, alış-satış farkı (spread) |
| **Türev** | Funding, açık pozisyon, AVAX'ın BTC ve ETH'ye göre durumu |
| **Volatilite** | Yakın dönem oynaklık ve uygulama riski |
| **Başkan** | Kararı **değiştiremez**, sadece açıklar |

Analistler önce birbirini görmeden görüş yazar, sonra tartışır. Uydurma sayı kullanan analistin oyu sayılmaz.

---

## Bir karar nasıl verilir: tek tık, 10 adım, sıfır el müdahalesi

```text
1  OKX TR canlı veri (Agent Trade Kit)
2  Veri tazeliği kontrolü
3  Dört analistin kör görüşü
4  Sayı doğrulayıcı: analistin söylediği her sayı gerçek veriyle karşılaştırılır
5  Tartışma ve son oy
6  Piyasayı tekrar oku (inceleme sırasında fiyat kaydı mı?)
7  Sabit risk kuralları
8  Kararı Avalanche'a mühürle (commit)
9  Kararı aç (reveal)
10 AL ise: bakiye ve piyasa son kez kontrol edilir → gerçek OKX TR spot emri
```

**AL için kural (kodda):** en az 3 doğrulanmış AL oyu, sıfır ENGELLE oyu, taze veri, yeterli derinlik, düşük spread, inceleme sırasında fiyat kaymaması. Bunlardan biri tutmazsa BEKLE ya da ENGELLE.

---

## Canlı sistem neden yerelde?

[darwin-council.vercel.app](https://darwin-council.vercel.app) adresindeki sürüm **sadece arayüzdür**; bu yüzden orada canlı OKX verisi ve karar görünmez.

Canlı backend **bilerek internete açılmadı**: gerçek para içeren bir **OKX TR alt hesabına işlem yetkisiyle bağlı** ve özel API anahtarlarını tutuyor. Gerçek emir gönderebilen bir sistemi hackathon süresinde internete açmak yerine, onu yerel makinede çalıştırıp **canlı demoda gösteriyoruz.**

Buna rağmen sistemin ürettiği her şey herkes tarafından doğrulanabilir: aşağıdaki tablodaki tüm tahminler, işlem kararları ve analist kayıtları **Avalanche Fuji'de, Snowtrace üzerinden açıkça görülebilir.**

---

## Bugünden canlı kanıt

*Canlı sistemden, 17 Ekim 19:23 itibarıyla. Tüm sayılar gerçek; sahte, tekrar oynatılmış ya da elle girilmiş veri yok.*

| | Sonuç | Kanıt |
|---|---|---|
| Otonom tahmin turu | **21 tur** tamamlandı; hepsi sonuçtan önce mühürlendi | Son tur: [commit](https://testnet.snowtrace.io/tx/0x5f931386e44a94abd3ec33e070100659b5bc7d94286a52d8ace1152172e1531c) · [reveal](https://testnet.snowtrace.io/tx/0x797937981793972b59dc81d50a5ab613ca0e02f345c1b2a762eb8696954b0cf8) |
| Konsey skoru | Brier **0,2416** (her zaman "%50" diyen referans: 0,250) | `GET /api/performance` |
| Darwin: ilk eleme | Türev analistinin çırağı 6 eşleşmiş **gelecek** canlı turda ustasını geçemedi → **elendi** | [doğum](https://testnet.snowtrace.io/tx/0x4d1e9e36fb4cb2bff0ae49ef487b4e29c6bf7b1024111effb4b66d87f9a8d2a8) · [eleme kararı](https://testnet.snowtrace.io/tx/0xb90805c486a020405019600f5fbe09eb7d397118a91eb9402c9355d98b493028) |
| Darwin: yeni aday | Momentum analistinin çırağı doğdu, şu an sınavda | [doğum](https://testnet.snowtrace.io/tx/0x245c3c9fd50d10e4214e44ce3f1f6d0d76ba0817fed5b5b4545d9c44ebea817b) |
| İşlem incelemesi | 8 inceleme, **8'i BEKLE**. 3'ü gerçek para yetkisiyle soruldu; hiç harcanmadı | Örnek karar: [commit](https://testnet.snowtrace.io/tx/0xfaff0cd1524bd463d957b8ed9da9fcc498f952a416f0c798bc66ec8356e76e15) · [reveal](https://testnet.snowtrace.io/tx/0x0e098fdd96d90e42a4127101d9182ec07a76ce92a0e24aa4a1b51e919d677647) |
| Gerçek para | OKX TR standart alt hesabı bağlı, bakiye canlı okunuyor, gerçek emir yetkisi açık | `npm run account:check` (emir göndermez) |

### Örnek: 18:36'daki gerçek karar, "5 USDT AVAX alayım mı?"

| Analist | Oy | Gerekçe (kısaltılmış) |
|---|---|---|
| Momentum | BEKLE | Kısa vadeli momentum olumsuz |
| Likidite | AL | Derinlik dengeli, spread makul |
| Türev | BEKLE | AVAX, BTC ve ETH'den zayıf; funding negatif |
| Volatilite | BEKLE | Fiyat düşüş eğiliminde, sinyal belirsiz |

Tüm risk kontrolleri geçti (veri 38 sn taze, spread 2 bp, ~75.000 USDT satış derinliği, fiyat kayması 0). Sadece **AL uzlaşısı (1/3)** sağlanamadı. Sonuç **BEKLE**: emir gönderilmedi, karar Fuji'de mühürlendi.

### Neden bugün hep BEKLE?

| 24 saatlik değişim (8 kararın kayıtlarından) | |
|---|---|
| AVAX | **−%3,2 … −%4,7** |
| BTC | −%0,2 … −%1,1 |
| ETH | −%1,2 … −%2,1 |

AVAX bugün piyasanın belirgin şekilde gerisinde kaldı ve kısa vadede de düşüyordu. Analistlerin gerekçeleri tam olarak bunu söylüyor. **İyi bir yatırım asistanı her soruya "AL" demez; parayı korumak da bir karardır.**

*Dürüst not:* Kayıtları incelediğimizde sistem tarafında da BEKLE'yi artıran üç etken bulduk: bir doğrulama kuralının bazı oyları boşa düşürmesi, tartışma turunda analistlerin çoğunluğa kayması ve aynı kısa vadeli düşüşün iki analist tarafından birden sayılması. Bunları güvenlik eşiklerini gevşetmeden düzeltiyoruz.

---

## Jüri kriterleriyle eşleşme

| Kriter | Darwin Konseyi'nde | Durum |
|---|---|---|
| **Agentic Design** · otonomi | Tek tıkla 10 adımlık akış; arka planda kimse tıklamadan 30 dakikada bir tahmin turu açıp mühürleyen, sonucu OKX'ten okuyup puanlayan ve analist değiştiren döngü | ✅ Canlı |
| **Agentic Design** · akıl yürütme ve araç kullanımı | 4 uzman rol; kör görüş → doğrulama → tartışma; OKX ATK piyasa + hesap + emir araçları; Avalanche kontratları | ✅ Canlı |
| **Technical Execution** · çalışan ürün | Canlı backend + Türkçe panel; arayüz ve sunum Vercel'de | ✅ (backend güvenlik gereği yerelde; bkz. "Canlı sistem neden yerelde?") |
| **Technical Execution** · mimari ve zorluk | Kesinti sonrası zincirden kurtarma, tekrar gönderimi önleyen kimlikler, "kabul" ile "gerçekleşti"yi ayıran emir takibi, eşleşmiş canlı sınav | ✅ |
| **Avalanche** · deploy | İki kontrat Avalanche Fuji'de (C-Chain test ağı) | ✅ Fuji · ana ağ sıradaki adım |
| **Avalanche** · güçlü yanlar | Hızlı kesinlik: işlem kararı mühürlenip ~4 saniyede açılıyor, emirden önce bağlayıcı oluyor; tahminler hedeften 28–30 dk önce zincirde | ✅ |
| **OKX** · agent araçları | Piyasa verisi, geçmiş mum, alt hesap bakiyesi ve spot emir **tamamen OKX Agent Trade Kit** üzerinden | ✅ |
| **OKX** · OKX.AI servisi | "İşlem öncesi ikinci görüş" servisi: herhangi bir trading agent'ı emir göndermeden önce konseye sorar | 🟡 Tasarım uygun, listeleme henüz yok |
| **Innovation** · özgünlük | Kendi analistlerini canlı sınavla seçen ve kararlarını zincirde kanıtlayan bir konsey | ✅ |
| **Innovation** · problem ve kullanıcı | Sinyal gruplarına ve AI botlarına körü körüne güvenen bireysel yatırımcılar; işlem yapan AI agent'lar | ✅ |
| **Innovation** · iş modeli ve pazara hazırlık | Karar başına ücretli servis; canlı OKX TR verisi, gerçek alt hesap, güvenlik sınırları hazır | 🟡 İlk gerçek AL emri henüz gerçekleşmedi |
| **Demo** | Canlı panelde "Konseye sor": adım adım tartışma, mühür ve karar | ✅ |

---

## Avalanche

| Kontrat | Ne yapar | Adres (Fuji, chainId 43113) |
|---|---|---|
| **DarwinCommit** | Tahmin ve işlem kararlarını önce hash olarak mühürler, sonuç gelince açar. Yanlış içerikle açma girişimini reddeder. | [`0x3cd8babe…e5a95a`](https://testnet.snowtrace.io/address/0x3cd8babe00dd10c08ebfc6435c1a41e6bde5a95a) |
| **DarwinLineage** | Her analistin doğumunu, sınav sonucunu ve emekliliğini kaydeder: konseyin soy ağacı. | [`0xd75db90c…8619dd`](https://testnet.snowtrace.io/address/0xd75db90c8337a12de7293882b0251b0af78619dd) |

**Neden Avalanche?** Karar zincire yazılmadan emir gönderilmiyor. Bu, kararı gerçekten bağlayıcı yapıyor, ama kullanıcının saniyeler içinde cevap alması gerekiyor. Avalanche'ın hızlı kesinliği sayesinde karar mühürlenip ~4 saniyede açılıyor; işlem ücreti de ihmal edilebilir düzeyde.

---

## OKX

**Kullandığımız OKX Agent Trade Kit araçları (hepsi canlı):**

| Amaç | ATK |
|---|---|
| Canlı fiyat | `market ticker` (AVAX, BTC, ETH) |
| Emir defteri | `market orderbook` |
| Mumlar ve sonuç çözümü | `market candles` (geçmiş mum sorgusu dahil) |
| Türev bağlamı | `market funding-rate`, `market open-interest` |
| Alt hesap ve bakiye | `account config`, `account balance`, `account asset-balance` |
| Gerçek emir | `market instruments`, `spot place`, `spot get` |

**OKX.AI vizyonu:** OKX.AI'da işlem yapan herhangi bir agent, emir göndermeden önce konseye "Bu emri şimdi göndereyim mi?" diye sorar. Cevap: AL / BEKLE / ENGELLE, nedeni ve zincirdeki kanıtı. Karar başına ücretli bir **ikinci görüş servisi**.

---

## Kimin için, nasıl para kazanır?

| Kullanıcı | Ne alır | Gelir modeli |
|---|---|---|
| OKX TR'de alım yapan bireysel yatırımcı | Uygulama içinde "Konseye sor" butonu | Abonelik ya da karar başına |
| OKX.AI'daki trading agent'ları | İşlem öncesi ikinci görüş API'si | Karar başına ödeme (x402 / A2MCP) |
| Sinyal sağlayıcılar | Zincirde kanıtlanmış başarı kaydı | Doğrulanmış itibar |

**OKX için değeri:** daha güvenli agent işlemleri, daha az kötü işlem, platforma daha fazla güven.

**Neden şimdi?** 2026'da AI agent'lar milyonlarca ödeme yapıyor ve aşırı yetkili agent'lar büyük kayıplara yol açtı. Kararı kanıtlayan ve sınırlayan bir katman eksik.

---

## Güvenlik

- Ayrı bir OKX TR **alt hesabı**; **para çekme yetkisi yok**
- İstek başına en fazla **5 USDT**, 24 saatte en fazla **1 gerçek emir**
- Gerçek emir için kullanıcının **açık onayı** gerekir; karar 2 dakikadan eskiyse emir gönderilmez
- Emirden hemen önce piyasa ve bakiye tekrar kontrol edilir
- Belirsiz bir ağ yanıtı **otomatik tekrar gönderilmez**; "kabul edildi" ile "gerçekleşti" ayrı gösterilir
- Otomatik tahmin turları **asla emir göndermez**
- Anahtarlar sadece yerelde; repoda hiçbir gizli bilgi yok

---

## Kendiniz doğrulayın

```bash
npm run audit:round -- <round-id>   # bir turun hash'i, OKX hedef mumu, puanı ve Fuji kaydı
npm run audit:lineage               # analist soy ağacını doğrudan zincirle karşılaştırır
```

Kurulum ve diğer komutlar için: [README](README.md).

---

## Bugün çalışan ve sıradaki

| ✅ Bugün çalışıyor | → Sıradaki adımlar |
|---|---|
| OKX TR canlı veriyle AL / BEKLE / ENGELLE | Konseyin ilk gerçek AL emri |
| Fuji commit/reveal + soy ağacı | Avalanche C-Chain ana ağı |
| Otonom 30 dakikalık tahmin sınavı | OKX.AI'da servis olarak listelenme |
| Gerçek Darwin kararı (çırak elendi) + yeni aday sınavda | Satış ve pozisyon koruma kararları, daha fazla coin |
| Gerçek OKX TR alt hesabı, gerçek emir yetkisi | Dış analist agent'ların konseye katılması |
| Canlı Türkçe panel + sunum | Backend'in internete açılması |

---

## İlham aldığımız projeler

ETHGlobal'in 2024–2026 arasındaki 20 hackathonundaki 8.000'den fazla projeyi inceledik. Özellikle şu projelerden ders çıkardık: [aoxbt](https://github.com/Nava-Labs/aoxbt) (uzman agent rolleri), [DAIO](https://github.com/openDAIO/agents) (denetlenebilir konsensüs), [LPLens](https://github.com/JeanBaptisteDurand/Open_Agent_2026) (önce kanıt gösteren sunum) ve [DeFlow](https://github.com/AceVikings/ethonline-defi-layer) (analizden korumalı eyleme geçiş). Darwin Konseyi bu fikirleri OKX TR verisi, gerçek alt hesap ve Avalanche kanıtıyla, canlı analist seçimi yapan özgün bir akışta birleştiriyor. Kod tamamen bu depoya özgüdür.
