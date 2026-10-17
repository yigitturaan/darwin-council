# Darwin Council backend

For the English project overview and setup, start with [the root README](../README.md). This file keeps detailed implementation and recovery notes in Turkish.

Bu backend yalnız canlı OKX TR Agent Trade Kit piyasa verisi, gerçek OpenAI API yanıtları ve Avalanche Fuji işlemleri kullanır. Fiyat, analist görüşü, çözüm ve zincir işlemi için sahte yedek akış yoktur. Bağlantı kesilirse durum/hata görünür.

Kurulu resmî `@okx_ai/okx-trade-cli` paketinin `market` komutları kullanılır. Her çağrıda hem `OKX_SITE=tr` hem `OKX_API_BASE_URL=https://tr.okx.com` sabitlenir; kullanıcının başka bölgeye ait CLI profili veri kaynağını sessizce değiştiremez. Ticker, orderbook, 1 dakikalık candles, AVAX swap fonlama ve açık pozisyon araçları bu makinede canlı doğrulandı. Fonlama ve açık pozisyon opsiyoneldir; kaynak eksik, geçersiz veya eskiyse metrik `null` ve kaynak durumu `UNAVAILABLE`/`INVALID`/`STALE` olur. Konsey BTC/ETH bağlamıyla devam eder. OKX'in genel TR uyumluluk tablosu henüz tüm modülleri onaylamadığından bu doğrulama yalnız kullanılan açık market araçları içindir.

Bu makinedeki Node.js `v25.6.1` ile geliştirildi. Kalıcılık için Node'un yerleşik `node:sqlite` modülü kullanılıyor; başka makinede çalıştırırken bu modülü içeren güncel Node sürümü gerekir.

## İlk kurulum

### OKX TR alt hesabını bağlama

OKX TR alt hesabında ayrı bir **Okuma + Al-Sat** API anahtarı oluştur. `Transfer`, `Ödül` ve çekim izinlerini seçme. OKX'in genel API dokümanı `Trade` yetkisinin bazı başka yazma işlemlerini de kapsayabileceğini belirtir; bu yüzden anahtarı yalnız alt hesap ve bu proje için kullan. Anahtar, gizli anahtar ve oluştururken belirlediğin şifreyi yalnız yerel `.env.okx` dosyasındaki üç satıra gir; sohbete veya ekran görüntüsüne koyma. Dosya `0600` iznindedir ve git tarafından dışlanır. `npm run account:check`, resmî ATK üzerinden üretim OKX TR hesabının standart alt hesap olduğunu, anahtarın izinlerini ve USDT'nin al sat / finans hesaplarındaki gerçek kullanılabilir bakiyesini kontrol eder; emir göndermez. Geniş yetkili bir anahtarı bu dosyada kullanma.

Anahtarın Al-Sat yetkisi olması tek başına otomatik emir başlatmaz. Gerçek emir için `ENABLE_LIVE_ORDERS=true`, kullanıcının ilgili istekte açıkça yürütmeyi seçmesi ve konseyin AL kararı vermesi gerekir; kod ayrıca risk sınırlarını uygular.

```bash
npm install
npm run contract:compile
npm run smoke:market
npm run smoke:fuji
```

`.env.example` örneğinden yerel `.env` oluşturulur. `OPENAI_API_KEY` bir tek OpenAI Platform API anahtarıdır; dört analist ayrı anahtar kullanmaz. `npm run wallet:create` yalnız Fuji test cüzdanı üretir ve özel anahtarını `.env` içine yazar. Bu cüzdanın **Fuji C-Chain test AVAX** bakiyesi olmalıdır. Anahtarlar terminal çıktısına, API'ye veya sohbete yazılmaz. `.env` git tarafından dışlanır.

```bash
npm run smoke:model
npm run contract:deploy
npm run lineage:deploy
```

Deploy başarılıysa adresler `.env` içindeki `FUJI_CONTRACT_ADDRESS` ve `FUJI_LINEAGE_ADDRESS` alanlarına otomatik kaydedilir. Aynı sözleşme adresi zaten dağıtılmışsa ilgili script yeniden deploy etmez. Ardından:

```bash
npm run backend
```

Backend yalnız `127.0.0.1:8787` adresine bağlanır. Canlı panel [http://127.0.0.1:8787/](http://127.0.0.1:8787/) adresindedir. Port `PORT` ile değiştirilebilir. `.env` değişirse çalışan backend yeniden başlatılmalıdır.

`npm run check:live` çalışan backend'in sağlık, canlı piyasa, Fuji, zamanlayıcı, tur, analist, olay, değerlendirme ve kullanım API'lerini **gerçek yanıtlarla** kontrol eder. Sonucun `PASS` olması 30 dakikalık çözüm/reveal akışının tamamlandığı anlamına gelmez; bunun için vadesi dolmuş tur ayrıca denetlenir.

`npm run check:recovery` iki gerçek tamamlanmış turun yerel makbuz kaybını ayrı geçici SQLite dosyasında sınar. Gerçek Fuji olayları ve ATK hedef mumları okunur; imzalama anahtarı bu süreçten çıkarılır, ürün kayıtlarına yazılmaz. `npm run check:resilience` gerçek CLI çalıştırma hatası ve erişilemeyen yerel RPC ile hata/toparlanma davranışını doğrular. Sahte API yanıtı kullanılmaz. `npm run db:backup` çalışan SQLite'ın tutarlı yedeğini `data/backups/` içine alıp bütünlüğünü kontrol eder.

Gerçek bir turun yerel veri/payload hash'ini ve Fuji kaydını bağımsız denetlemek için `npm run audit:round -- <round-id>` çalıştırılır. Vade dolmuşsa hedef mum yeniden canlı ATK'den okunur, sonuç ve Brier matematiği karşılaştırılır; reveal varsa zincirdeki `Revealed` olayı da doğrulanır. Komut açıklanmamış payload'ı RPC'ye göndermez veya işlem açmaz.

`npm run audit:lineage` mevcut analistlerin kaynak özetlerini, ebeveyn kimliklerini, statülerini ve kayıt/karar işlem makbuzları ile sözleşme olaylarını doğrudan Fuji'den denetler. Bu salt okunur komut tur açmaz. Adayın doğumu ve kararının kanıtı, ancak gerekli gerçek turlar tamamlandıktan ve işlemleri zincirde onaylandıktan sonra PASS olur.

Fuji soy ağacı işlemi onaylandıktan sonra süreç yerel makbuzu yazamadan kapanırsa backend sözleşme olaylarını gerçek bloklardan tarayıp işlem hash'ini geri kaydeder. Bu kurtarma dört gerçek kurucu işlemiyle ayrı geçici veritabanında doğrulandı.

## Canlı akış

- Otomatik tur: ilk gerçek Darwin terfi/ret kararına kadar `:00`, `:10`, `:20`, `:30`, `:40`, `:50` sınırlarında; karar sonrası otomatik `:00` ve `:30` düzenine döner. Tahmin ufku her iki dönemde 30 dakikadır. Sıklık `.env` içindeki `DARWIN_FAST_INTERVAL_MINUTES` (varsayılan 10) ve `DARWIN_STEADY_INTERVAL_MINUTES` (varsayılan 30) ile ayarlanır. `AUTO_ROUNDS=false` planı kapatır.
- Otomatik saat manuel turla çakışırsa otomatik tur sıraya alınır ve aktif oluşturma bitince canlı veriyi yeniden okuyarak başlar. Erişim eksikse `SCHEDULE_SKIPPED` olayı kaydedilir.
- Manuel tur: `POST /api/rounds`. Aynı veri, model ve zincir yolu. Yalnız bir tur oluşturma akışı aynı anda çalışır. `Idempotency-Key` başlığıyla tekrarlanan istekler restart sonrasında da aynı turu döndürür.
- Veri yenileme: `POST /api/live-market/refresh`. Yeni tur başlatmaz.
- Tur sorusu: son **tamamlanmış** AVAX-USDT 1 dakikalık mum kapanışından tam 30 dakika sonraki tamamlanmış mum kapanışı daha yüksek mi? Eşit fiyat `0` sonucudur.
- Dört analist ilk kör görüşü ve diğerlerinin ilk görüşünü gördükten sonraki son görüşü gerçek OpenAI çağrılarıyla üretir. Yapılandırılmış sayısal `claims` gerçek ATK paketiyle karşılaştırılır. Uyuşmazlık veya çekimserlik konsey ortalamasına katılmaz.
- Tahmin ayrıntıları Fuji `commit` işlemi onaylanmadan API'de gösterilmez. Onay beklenirken yalnız ilerleme durumu ve varsa bekleyen işlem hash'i görünür.
- Claim toleransı fiyatta en az 0.001 USDT, yüzde metriklerinde 0.02 yüzde puanı, spread'de 0.1 baz puan, emir defteri dengesinde 0.005; diğerlerinde değerin %0.5'idir. Serbest metindeki bütün cümlelerin doğrulandığı iddia edilmez.
- Tam turun soru, başlangıç/son tahminleri, veri hash'i, zamanları ve tuzu Fuji'de `keccak256(JSON)` ile taahhüt edilir. Sonuç zamanı geldiğinde gerçek hedef mum okunur, Brier puanı hesaplanır ve taahhüt edilen içerik Fuji'ye açılır. Zincir hash'i verinin dış dünyada doğru olduğunu kanıtlamaz.
- Saat sınırında yeni commit ile eski turun reveal'i aynı cüzdandan istenebilir. Gönderimler sıraya alınır; nonce Fuji RPC'nin `pending` sayacından okunur. İmzalamadan önce zincir kimliği `43113` doğrulanır.
- Tur ve olay geçişleri SQLite işleminde birlikte saklanır. Henüz gönderim aşamasına gelmemiş yarım turlar restart'ta `ABORTED` olur. `COMMITTING` aşamasında kesilenler `CHAIN_PENDING` olarak gerçek sözleşme/olaylardan kurtarılır; makbuz kaybı yeni tahmin ürettirmez. Kayıp reveal makbuzu da gerçek `Revealed` olayından bulunur. RPC'nin 100 blokluk sorgu sınırı korunur. Geç kalmış taahhüt puanlanmaz.
- Ağ hatalarında artan bekleme süresiyle yeniden deneme yapılır (en fazla 120 saniye aralık). Vadesi gelen tüm bekleyen kayıtlar işlenir; yalnız son 100 turla sınırlı değildir. Sonuç ve puan öncesinde yerel tahmin, kaynak hash'i ve taahhüt tekrar karşılaştırılır.
- Saat sınırı ve kullanılan sıklık SQLite'a kaydedilir; aynı saat diliminde restart ek otomatik tur oluşturmaz. 10→30 dakika geçişinde zaten açılmış tur yeniden açılmaz. Uyku/çevrimdışı sürede kaçan turlar geçmiş tahmin gibi doldurulmaz. SIGINT/SIGTERM yeni işleri durdurur, devam eden işe en fazla 20 saniye verir; kalan durum restart'ta kurtarılır.
- En az altı gerçek çözülmüş turdan önce ağırlıklar eşittir ve Darwin adayı üretilmez. Sonrasında yeterli örneklemi olan en zayıf rolün geçmiş gerçek tahminlerindeki kalibrasyon hatasına göre karşı görüş talimatı oluşturulur. Aday ayrı OpenAI analisti olarak **gelecek canlı turlarda** altı kez sınanır. Aday geçmiş veriyle geri test edilmez; yeterli farkla daha iyi puan alırsa rol değişir, almazsa reddedilir. Kaynak talimatı, ebeveyn kimliği ve gerçek eğitim turu kimlikleri Fuji'de hash ile bağlanır; terfi/ret ve emeklilik kararları da ayrı zincir olaylarıdır.
- Ölçülen analist ağırlıkları yalnız ilgili analistin en az altı gerçek puanından sonra uygulanır; henüz yeterli örneği olmayan rolün ağırlığı nötr kalır. Rejime özel ağırlık bu sürümde iddia edilmez.
- Darwin rol seçimi için etkin puan `Brier + 0.1 × hatalı claim oranı` kullanılır; ham Brier ayrıca gösterilir. Adayın terfi etmesi için altı eşleştirilmiş canlı turdaki etkin ortalamasının mevcut koltuktan en az 0.02 düşük olması gerekir.

## API

| İstek | İşlev |
|---|---|
| `GET /health` | Backend, kimlik bilgisi var/yok, ATK ve Fuji RPC durumu |
| `GET /api/live-market` | Taze ATK paketi veya açık hata/tazelik durumu |
| `GET /api/account` | Bağlı OKX TR alt hesabının gerçek toplam ve kullanılabilir USDT bakiyesi; yalnız okuma |
| `POST /api/live-market/refresh` | Gerçek veri yeniden okuma |
| `GET /api/rounds` | Son turların kısa durum, olasılık, sonuç ve zincir işlem özeti |
| `GET /api/rounds/:id` | Seçilen turun veri, analist ve kanıt ayrıntısı; tuz reveal öncesi gizli |
| `POST /api/rounds` | Aynı canlı akışla manuel tur |
| `GET /api/analysts` | Analist statüsü, canlı örneklem ve Brier |
| `GET /api/usage` | SQLite'a kaydedilmiş Darwin turlarının OpenAI token kullanımı ve fiyat tablosuna dayalı tahmini maliyeti; API hesap bakiyesi değildir |
| `GET /api/events?after=<seq>` | Olaylar |
| `GET /api/evolution` | Gerçek sonuç sayısı, aday durumu ve altı örneklik eşikler |
| `GET /api/performance` | Gerçek Brier ortalaması ve %50 referans; istatistiksel başarı iddiası yok |
| `GET /api/lineage` | Gerçek Fuji soy ağacı, işlem bağlantıları ve doğrulama durumu |
| `GET /api/assessment` | Diğer ajanların kullanabileceği son Fuji taahhütlü konsey değerlendirmesi |
| `POST /api/trade-intents` | 5 USDT'lik canlı AVAX spot alım isteğini değerlendirir; `execute:true` ve etkin işlem bağlantısı varsa yalnız AL kararı sonrası gerçek emir gönderebilir |
| `GET /api/trade-intents` | Son işlem değerlendirmeleri, oylar, karar kuralları ve Fuji kanıtları |
| `GET /api/trade-intents/:id` | Tek işlem değerlendirmesinin ilerleyişi ve doğrulanmış sonucu |

Yanıtlar `mode: "live"` ve backend zamanını taşır. `mode`, verinin taze olduğu anlamına gelmez; durum ve kaynak saatleri ayrıca okunmalıdır. Dashboard için ayrıntılı sözleşme [API.md](./API.md) içindedir. Yerel uygulama akışı ve güvenlik sınırları kök README içinde özetlenir.

`GET /health` otomatik zamanlayıcının açık olup olmadığını, etkin 10/30 dakika sıklığını ve sonraki tur saatini de döndürür. Piyasa paketi arka planda 30 saniyede bir gerçek ATK çağrısıyla yenilenir. Eşzamanlı yenileme istekleri aynı canlı çağrıyı paylaşır.

## Bilinen erişim kapıları

`OPENAI_API_KEY`, Fuji cüzdanında test AVAX ve sözleşme adresi olmadan tam tur açılmaz. İlk gerçek tur taahhüt edilmeden model/chain akışı geçti sayılmaz; ilk gerçek sonuç hedef mum kapanmadan gösterilemez.

Hedef mum doğrudan `candles --after <dueCandleEnd> --limit 3` ile sorulur. ATK gerektiğinde resmî tarihsel uç noktaya geçer; üç gün önceki gerçek mumla doğrulandı. Kaynak o mumu yine sağlayamazsa `RESOLUTION_PENDING` olur; eksik sonucu uydurmaz. Haber ve smart money bağlı değildir. Funding ve OI gerçek ATK kaynaklarından opsiyonel olarak bağlıdır. Mevcut roller yalnız AVAX-USDT içindir; farklı enstrümanla sessizce AVAX türev verisi karıştırılmaz.

Boş/null/boolean sayısal kaynak değerleri sıfıra çevrilmez; geçersiz kabul edilir. Fiyatlar pozitif olmalıdır, her çekirdek kaynağın saati ayrı kontrol edilir. Eksik 15 dakikalık mum dizisiyle 15 dakikalık aralık hesaplanmaz. Modelin sayısal claim değeri de gerçek JSON sayısı olmalıdır.

## Çalıştırma ve yedek

Bilgisayar ve backend açıkken otomatik döngü çalışır. Uykudan dönüşte kaçırılmış geçmiş tahmin üretilmez; mevcut taahhütlerin hedef mumları gerçek ATK kaynağından çözülür. API kredisi, test AVAX ve internet erişimi gerçek bağımlılıklardır. Özel RPC kullanılırsa Fuji `eth_getLogs` ve tarihsel blok erişimini desteklemelidir.

Yedekten dönüş için önce backend'i durdurun. Mevcut `data/darwin.sqlite`, `-wal` ve `-shm` dosyalarını birlikte başka bir klasöre taşıyıp koruyun; seçilen doğrulanmış yedeği `data/darwin.sqlite` olarak kopyalayın. `.env` içindeki sözleşme ve proje cüzdanı aynı olmalı. Sonra backend'i başlatıp `check:live` ve ilgili `audit:round` komutlarını çalıştırın. Yedekten sonraki turlar o yedekte bulunmaz; en güncel canlı veritabanını saklamak önemlidir. Yedeklerde açıklanmamış tur içeriği olabilir; paylaşmayın.
