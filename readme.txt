LAVIVA
======

Laviva, gerçek zamanlı, şifre korumalı odalar üzerinden mesajlaşma sağlayan
basit bir sohbet uygulamasıdır. Node.js (Express) ve WebSocket (ws) ile
yazılmıştır; metin mesajlarının yanı sıra sesli mesaj ve dosya/fotoğraf/video
paylaşımını da destekler.


ÖZELLİKLER
----------
- Şifre korumalı sohbet odaları (varsayılan olarak 5 oda gelir)
- Gerçek zamanlı mesajlaşma (WebSocket)
- Anlık "yazıyor..." göstergesi
- Online kullanıcı sayısı / listesi
- Sesli mesaj gönderme
- Fotoğraf, video ve dosya paylaşımı (Cloudinary üzerinden yüklenir)
- Mesaj silme (sadece mesajı gönderen kişi tarafından)
- Mesajlar diskte JSON dosyalarında saklanır, 24 saatten eski mesajlar
  otomatik olarak temizlenir
- Oda yönetimi için basit bir admin paneli/API'si
  (oda ekleme, düzenleme, silme, mesajları temizleme)
- Belirli bir tarihte otomatik "kapanma" (shutdown) zamanı ayarlanabilir


PROJE YAPISI
------------
laviva-main/
├── package.json     -> Bağımlılıklar ve başlatma komutu
├── server.js        -> Express + WebSocket sunucusu, tüm iş mantığı
├── railway.toml      -> Railway platformu için deploy ayarları
└── public/
    └── index.html    -> İstemci tarafı arayüz (tek sayfa uygulama)


GEREKSİNİMLER
-------------
- Node.js (v16 veya üzeri önerilir)
- npm
- Cloudinary hesabı (dosya/sesli mesaj/medya yükleme özelliği için)


KURULUM
-------
1. Bağımlılıkları yükleyin:

   npm install

2. Aşağıdaki ortam değişkenlerini tanımlayın (Cloudinary için gereklidir):

   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...

   İsterseniz portu özelleştirmek için:

   PORT=8080

3. Sunucuyu başlatın:

   npm start

   veya

   node server.js

4. Tarayıcıdan http://localhost:8080 adresine gidin.


VARSAYILAN ODALAR
------------------
Uygulama ilk çalıştığında, eğer rooms.json dosyası yoksa şu odalar
otomatik olarak oluşturulur:

  Oda 1  -> şifre: sifre1
  Oda 2  -> şifre: sifre2
  Oda 3  -> şifre: sifre3
  Oda 4  -> şifre: sifre4
  Oda 5  -> şifre: sifre5

NOT: Üretim ortamına almadan önce bu şifreleri admin panelinden
değiştirmeniz şiddetle önerilir.


ADMIN PANELİ
------------
Varsayılan giriş bilgileri:

  Kullanıcı adı: admin
  Şifre: admin

NOT: Bu bilgiler server.js içinde sabit (hardcoded) olarak tanımlıdır.
Gerçek bir ortamda kullanmadan önce bu değerleri değiştirmeniz ve
güvenli bir kimlik doğrulama yöntemiyle değiştirmeniz önemle tavsiye edilir.

Admin API uç noktaları:
  POST   /admin/login                -> Giriş yapar, token döner
  POST   /admin/logout                -> Çıkış yapar
  GET    /admin/rooms                 -> Odaları listeler
  POST   /admin/rooms                 -> Yeni oda ekler
  PUT    /admin/rooms/:id             -> Oda bilgilerini günceller
  DELETE /admin/rooms/:id             -> Odayı siler
  DELETE /admin/rooms/:id/messages    -> Odanın mesajlarını siler

Admin uç noktalarına istek yaparken "x-admin-token" başlığı (header)
gönderilmesi gerekir.


PUBLIC API UÇ NOKTALARI
------------------------
  GET  /shutdown-time          -> Kapanma zamanını döner
  GET  /rooms                  -> Mevcut odaların (isim) listesini döner
  POST /verify-room             -> Oda şifresini doğrular
  POST /upload-audio             -> Sesli mesaj yükler
  POST /upload-file              -> Dosya/fotoğraf/video yükler


DEPLOY (RAILWAY)
----------------
Proje, railway.toml dosyası sayesinde Railway platformuna doğrudan deploy
edilebilecek şekilde yapılandırılmıştır. Başlangıç komutu:

  node server.js

Railway üzerinde ortam değişkenlerini (CLOUDINARY_*, PORT vb.) panel
üzerinden tanımlamanız gerekir.


GÜVENLİK NOTLARI
-----------------
- Admin kullanıcı adı/şifresi ve varsayılan oda şifreleri kod içinde
  sabit olarak tanımlıdır; canlıya almadan önce değiştirilmelidir.
- Admin token'ları bellekte (in-memory) tutulur; sunucu yeniden
  başlatıldığında tüm oturumlar geçersiz olur.
- Cloudinary API anahtarlarınızı asla genel/herkese açık şekilde
  paylaşmayın; ortam değişkeni olarak saklayın.


LİSANS
------
Belirtilmemiştir.
