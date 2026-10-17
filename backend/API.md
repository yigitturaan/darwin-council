# Darwin backend — dashboard bağlantı sözleşmesi

Canlı V3 ekranı backend tarafından `/` adresinde servis edilir. Tasarımdaki örnek sayılar canlı API verileriyle değiştirilmiştir.

## Ortak kurallar

- Adres: `http://127.0.0.1:8787`. Yalnız yerel erişim; farklı port `PORT` ile seçilir.
- JSON yanıt, `Cache-Control: no-store`. Zamanlar Unix **milisaniye**; explorer blok numaraları string.
- `mode: live` gerçek kaynak kullanan ürün modudur. Tazelik için ayrıca `status`, `sourceTimes`, `observedAt` kontrol edilmeli.
- Eksik sayı `null`; yüzde/sıfır/başarılı sonucu ile doldurulmaz. Olasılık 0–1, yüzdeler yüzde puanı, spread baz puan, fiyat USDT.
- Frontend aynı origin üzerinden sunulmalı veya geliştirme sunucusunun yerel proxy'sini kullanmalı. Yabancı `Origin` ile POST ve yabancı `Host` reddedilir. İnternete açma bu yerel sürümün kapsamı değildir.

## Okuma

| Yol | Temel alanlar / anlam |
|---|---|
| `/health` | `READY/DEGRADED`; `credentials` yalnız var/yok; `market`; `model.lastVerifiedAt`, son hata; `fuji.chainId/blockNumber/contractStatus/signerBalanceAvax`; `scheduler.nextScheduledAt/phase/intervalMinutes/forecastHorizonMinutes`; `worker.lastCompletedAt/lastError/pendingRecovery` |
| `/api/live-market` | `LIVE/STALE/UNAVAILABLE/NOT_LOADED`; varsa `data.metrics`, `data.sourceTimes`, `data.derivatives`; başarısız yenilemede yalnız hata ve son başarılı okumanın zaman bilgileri |
| `/api/rounds` | `rounds`: son 100 turun özeti, en yeni önce. Geçmiş tur fiyatları canlı ticker gibi sunulmaz. 10 dakikalık geçici dönemde aynı anda yaklaşık üç bekleyen tur olabilir; ana ekranda en yeni taahhütlü tur öne çıkarılıp diğerleri kısa geçmişe alınabilir. |
| `/api/rounds/:id` | `round`: snapshot, `council.initial/final`, claim'ler, başkan, ağırlıklar, zincir işlemleri ve varsa çözüm |
| `/api/analysts` | `analysts`: ACTIVE/TRIAL/RETIRED/REJECTED; gerçek örneklem sayısı, ortalama Brier ve etkin skor; örneklem yoksa skor null |
| `/api/evolution` | Gerçek çözülmüş tur sayısı, yeterli örneği olan analist sayısı, aday ve ebeveyn kimliği, eşleştirilmiş aday sonucu sayısı, son karar ve altı sonuç eşikleri. `COOLDOWN` ilk gerçek karardan sonraki bekleme dönemidir. |
| `/api/performance` | Yalnız gerçek çözülmüş turlardan konsey Brier ortalaması, sürekli %50 tahmin referansı (`0.25`), referansa göre beceri skoru ve gerçek gözlemler. `inference: DESCRIPTIVE_ONLY`; üst üste binen 30 dakikalık pencereler bağımsız örneklem sayılmaz. |
| `/api/lineage` | Fuji soy ağacı sözleşmesindeki gerçek analist durumları; `VERIFIED/PENDING/MISMATCH`, kayıt ve karar işlem hash'leri, kaynak özeti. `PENDING` senkronizasyonun henüz bitmediğini belirtir. |
| `/api/events?after=0` | `events`: seq artan sırada en fazla 100 olay. Sonraki çağrı `after=nextCursor`; boş sayfa gelene kadar devam edilebilir. |
| `/api/assessment` | Son taahhütlü değerlendirme; `validity: ACTIVE_FORECAST/HISTORICAL_FORECAST`, kaynak zamanı ve hedef zamanı. Eski tahmin yeni tavsiye gibi gösterilmez. |
| `/api/usage` | Kaydedilmiş tur çağrılarının token sayısı ve tahmini maliyeti; `accountBalanceUsd` null. Hesap bakiyesi değildir; kaydedilmemiş/yarım çağrıları ve smoke testleri kapsamaz. |
| `/api/account` | Standart OKX TR alt hesabının gerçek USDT `totalUsdt`, `availableUsdt`, `observedAt` değeri. 30 saniyeye kadar önbellekli; anahtar dönmez, hesap erişimi yoksa 503. |
| `/api/trade-intents` | Son 20 canlı AVAX spot alım değerlendirmesi; en yeni önce. `execution.status` gerçek emrin durumunu ayrıca gösterir. |
| `/api/trade-intents/:id` | Tek isteğin analist oyları, doğrulanmış iddialar, karar kuralları, kaynak hash'leri ve Fuji commit/reveal bağlantıları. Karar yalnız zincir teyidinden sonra görünür. |

`scheduler.phase` ilk gerçek Darwin kararına dek `FAST_UNTIL_DARWIN_DECISION` (varsayılan 10 dakika), sonra `STEADY_AFTER_DARWIN_DECISION` (varsayılan 30 dakika) olur. `forecastHorizonMinutes` her zaman 30'dur. Aralık değiştiğinde frontend sunucunun bildirdiği `nextScheduledAt` değerini kullanmalı. `model.LIVE_VERIFIED` son başarılı gerçek çağrının kanıtıdır; her sağlık isteğinde yeni ücretli model çağrısı yapılmaz. `lastVerifiedAt` gösterilmeli. Metrik kaynağının LIVE olması analistin yorumu veya fiyat tahmininin doğru olduğu anlamına gelmez.

`TRIAL` analist `council.initial` ve `council.final` içinde kendi gerçek model yanıtlarıyla görünür; karar verilene kadar `council.weights.weights` içinde yer almaz ve konsey olasılığını değiştirmez. `pairedTrialResults` yalnız aday ile ebeveynin **gelecekte aynı turda** puanlandığı gerçek çözülmüş turlarla artar.

## Yazma

### POST `/api/rounds`

Gövde gerekmez. Her kullanıcı tıklamasında `crypto.randomUUID()` ile yeni `Idempotency-Key` üretin; ağ hatası nedeniyle **aynı isteği** tekrar gönderirken aynı anahtarı koruyun. Başlık 8–100 karakter, harf/rakam/alt çizgi/tire kabul eder.

- `202`: `accepted: true`, `roundId`. Aynı anahtar yeniden gönderilirse `reused: true`; model/zincir maliyeti yeniden oluşmaz. Tekrar sonrası tur başarısız olsa da aynı id döner; yeni deneme yeni anahtar kullanır.
- `409`: `ROUND_IN_PROGRESS`, `MISSING_CONFIG` veya `SHUTTING_DOWN`; açıklanan durumu gösterin.
- `400`: geçersiz idempotency anahtarı.

`202` yalnız başlatma kabulüdür. Detay/olay API'sinden gerçek ilerleme izlenir; anında sonuç yaratılmaz.

### POST `/api/live-market/refresh`

Gerçek ATK verisini yeniler. Yeni konsey turu veya model çağrısı açmaz. HTTP 200 içindeki `UNAVAILABLE` durumunu başarı gibi boyamayın.

### POST `/api/trade-intents`

`Content-Type: application/json`, `Idempotency-Key: crypto.randomUUID()` ve `{"amountUsdt":5,"execute":false}` gönderin. Kabul edilen tutar **5 USDT**'dir. `execute` varsayılan `false` değerindedir. `true` yalnız kullanıcı gerçek spot alımını açıkça seçtiğinde, `ENABLE_LIVE_ORDERS=true` ve OKX alt hesap anahtarı hazırsa kabul edilir. `202` yanıtı yalnız isteğin alındığını söyler; sonucu `GET /api/trade-intents/:id` ile izleyin. Aynı anahtarın tekrarı yeni model çağrısı veya yeni Fuji işlemi açmaz.

Dört aktif analist önce kör oy verir, sonra doğrulanmış akran görüşleriyle ikinci oyunu verir. Her sayısal iddia OKX TR anlık görüntüsüyle karşılaştırılır; yanlış veya model hatası içeren görüş çoğunluğa sayılmaz. Model değerlendirmesinin sonunda piyasa **yeniden** okunur. Kodun sabit risk kapıları veri tazeliği, alış satış farkı, son 15 dakika aralığı, emir defteri, değerlendirme sırasındaki fiyat kayması, yeterli doğrulanmış analist ve en az üç AL oyu / sıfır ENGELLE oyudur. Bunlar kâr tahmini değildir; küçük tutar otomatik AL anlamına gelmez. Karar `BUY/WAIT/BLOCK` API değerleriyle taşınır; arayüz bunları `AL/BEKLE/ENGELLE` olarak gösterir.

Karar önce Fuji testnet'te `trade:<intentId>` kimliğiyle mühürlenir, ardından açılır. `execute:false` ise kesinlikle emir yoktur. `execute:true` ise yalnız `BUY` kararından sonra taze piyasa ve gerçek alt hesap bakiyesi yeniden kontrol edilir; önceki 24 saatte başka bir gerçek emir varsa veya karar 2 dakikadan eskiyse emir engellenir. Emir `cash` modunda `AVAX-USDT` **market buy**, tutar birimi `quote_ccy` ile en fazla istenen USDT kadardır. `clOrdId` intent kimliğinden türetilir, `SUBMITTING` işlemden önce saklanır; belirsiz ağ yanıtı **otomatik yeniden gönderilmez**. `ACCEPTED` ve `FILLED` farklı durumlardır. Arka plandaki yön tahmin turları emir tetiklemez. Gerçek emir yolu canlı hesapla uçtan uca sınanmadan hazır sayılmaz.

## Tur durumları

| Durum | Ekrandaki anlam |
|---|---|
| CREATING / DATA_READY / ANALYZING / VERIFIED / COMMITTING | Hazırlanıyor; onaylanmış tahmin henüz yok |
| CHAIN_PENDING | Fuji işlemi gönderim/teyit/kurtarma aşamasında; varsa `pendingCommitTx` gösterilir |
| COMMITTED | Tahmin sonuçtan önce zincire kaydedildi; sonuç henüz yok |
| DUE / RESOLUTION_PENDING | Vade geldi; gerçek hedef mum doğrulaması bekleniyor |
| RESOLVED | Gerçek hedef mum ve puan mevcut; reveal teyidi bekleniyor |
| REVEALED | Sonuç ve zincirde açıklanan içerik mevcut |
| ABSTAINED | Uygun doğrulanmış analist tahmini yok |
| SOURCE_UNAVAILABLE | Çekirdek gerçek veri okunamadı |
| ABORTED | Tur tamamlanamadı veya geç kaldı; başarısız tahmin diye puanlanmaz |

API, taahhüt onayından önce `council`/snapshot ayrıntısını gizler. `revealPayload` hiçbir zaman ham alan olarak dönmez; yalnız REVEALED durumda `revealedPayload` bulunur. Bekleyen turda `outcome`, `councilBrier` ve `targetClose` null olmalıdır. Null'u 0'a çevirmeyin.

Sayısal claim `VERIFIED/MISMATCH/UNVERIFIED` taşır; doğrulama yalnız yapılandırılmış sayısal alanlara uygulanır. Serbest metnin tümünün doğrulandığı söylenmez.

## Polling önerisi

Tur/olay/analist/evolution için 3–5 saniye; performans ve soy ağacı için 15–30 saniye; piyasa için 15–30 saniye. Backend piyasa kaynağını arka planda 30 saniyede bir yeniler. İstek başarısızsa artan aralıkla tekrar deneyin ve bağlantı durumunu gösterin. Hedef süreyi backend zamanına göre hesaplayın; sayaç sıfıra gelince sonuç üretmeyin, gerçek çözümü bekleyin.
