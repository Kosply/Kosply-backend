/**
 * @title Seed — dashboard fixtures
 * @notice Fills every surface the admin dashboard renders with varied sample
 * @notice rows: marketplace users, sellers, products, KTM verifications, fraud
 * @notice reports, support tickets (+threads), the AI model registry and the
 * @notice AI tool-invocation benchmark.
 * @dev Idempotent: every row upserts on a stable key (email, userId, reportNo,
 * @dev ticketNo, modelId, or an explicit `seed-*` id), so re-running refreshes
 * @dev the fixtures instead of duplicating them.
 * @dev Timestamps are staggered relative to `now` (and refreshed on re-run), so
 * @dev the queues look alive and the "Open Today / Closed Today" tiles on
 * @dev /contact-support show non-zero numbers.
 * @dev Cross-story fixtures, so the moderation history looks like a real tail:
 * @dev  • the ARCHIVED product is the target of the RESOLVED `DELETE_PRODUCT`
 * @dev    report, and the RESOLVED `BAN_USER` report belongs to the frozen
 * @dev    seller whose verification is `isActive: false`.
 * @dev  • PENDING reports/verifications are the freshest rows, IN_REVIEW /
 * @dev    RESOLVED / REJECTED ones are progressively older.
 * @dev Marketplace passwords are SHA-256 markers, NOT credentials (mirrors
 * @dev `lib/db/schema/seed.js`): those rows are deliberately not login-able.
 * @dev The only login-able account is the dashboard operator from `accounts.js`.
 */
const crypto = require('node:crypto');

/**
 * @notice Marker password for marketplace fixtures.
 * @dev `bcrypt.compare` can never match a SHA-256 hex string, so these accounts
 * @dev cannot sign in — exactly the property we want for demo bodies.
 * @param {string} label Unique per fixture.
 * @returns {string} Hex marker.
 */
const markerHash = (label) => crypto.createHash('sha256').update(`seed-demo:${label}`).digest('hex');

/**
 * @notice Timestamp `days`/`hours`/`minutes` before now.
 * @param {{ days?: number, hours?: number, minutes?: number }} offset Age of the row.
 * @returns {Date} Relative date used to stagger the fixtures.
 */
const ago = ({ days = 0, hours = 0, minutes = 0 } = {}) =>
  new Date(Date.now() - ((days * 24 + hours) * 60 + minutes) * 60 * 1000);

/** @notice Marketplace accounts. Roles/sellers/src are chosen for variety. */
const USERS = [
  { email: 'arima.kousei@kosply.test', username: 'arimakousei', name: 'Muhammad Arima Kousei', universitas: 'Universitas Brawijaya', programStudi: 'Teknik Mesin', role: 'BUYER' },
  { email: 'alisa.kujou@kosply.test', username: 'alisakujou', name: 'Alisa Mikhailovna Kujou', universitas: 'Universitas Airlangga', programStudi: 'Teknologi Informasi', role: 'SELLER', bio: 'Lapak mahasiswa TI: laptop, buku, dan alat praktikum bekas.' },
  { email: 'manhattan.cafe@kosply.test', username: 'manhattancafe', name: 'Manhattan Cafe', universitas: 'Universitas Indonesia', programStudi: 'Kedokteran Hewan', role: 'SELLER', bio: 'Peralatan kos & dapur, semua masih layak pakai.' },
  { email: 'bima.aryo@kosply.test', username: 'bimaaryo', name: 'Bima Aryo', universitas: 'Universitas Padjadjaran', programStudi: 'Farmasi', role: 'SELLER', bio: 'Jual barang elektronik bekas.', isActive: false },
  { email: 'nadia.putri@kosply.test', username: 'nadiaputri', name: 'Nadia Putri', universitas: 'Universitas Gadjah Mada', programStudi: 'Ilmu Komputer', role: 'BUYER' },
  { email: 'raka.pratama@kosply.test', username: 'rakapratama', name: 'Raka Pratama', universitas: 'Institut Teknologi Bandung', programStudi: 'Teknik Elektro', role: 'BUYER' },
  { email: 'dimas.saputra@kosply.test', username: 'dimassaputra', name: 'Dimas Saputra', universitas: 'Universitas Diponegoro', programStudi: 'Akuntansi', role: 'BUYER' },
  { email: 'clara.wijaya@kosply.test', username: 'clarawijaya', name: 'Clara Wijaya', universitas: 'Universitas Bina Nusantara', programStudi: 'Desain Komunikasi Visual', role: 'BUYER' },
  { email: 'intan.permata@kosply.test', username: 'intanpermata', name: 'Intan Permata', universitas: 'Universitas Negeri Malang', programStudi: 'Pendidikan Bahasa Inggris', role: 'BUYER' },
  { email: 'sinta.dewi@kosply.test', username: 'sintadewi', name: 'Sinta Dewi', universitas: 'Universitas Sebelas Maret', programStudi: 'Agroteknologi', role: 'BUYER' },
  { email: 'yusuf.maulana@kosply.test', username: 'yusufmaulana', name: 'Yusuf Maulana', universitas: 'Universitas Hasanuddin', programStudi: 'Teknik Sipil', role: 'BUYER' },
];

/** @notice Catalog rows. Statuses cover ACTIVE / SOLD / ARCHIVED. */
const PRODUCTS = [
  { id: 'seed-product-1', sellerEmail: 'alisa.kujou@kosply.test', title: 'Laptop ThinkPad X230', description: 'i5 gen 3, RAM 8GB, SSD 256GB. Baterai masih 3 jam, minus body lecet pemakaian.', price: 2650000, stock: 1, category: 'Elektronik', latitude: -7.952, longitude: 112.614, locationLabel: 'Kos daerah UB, Malang', imageUrls: ['https://cdn.kosply.test/seed/thinkpad-x230.jpg'] },
  { id: 'seed-product-2', sellerEmail: 'alisa.kujou@kosply.test', title: 'Buku Kalkulus Purcell Edisi 9', description: 'Coretan tipis di bab 1-2, sisanya masih bersih. Cocok buat mahasiswa baru.', price: 45000, stock: 2, category: 'Buku', latitude: -7.268, longitude: 112.751, locationLabel: 'Perpustakaan pusat, Surabaya', imageUrls: ['https://cdn.kosply.test/seed/kalkulus-purcell.jpg'] },
  { id: 'seed-product-3', sellerEmail: 'manhattan.cafe@kosply.test', title: 'Kipas angin kos Cosmos', description: 'Masih dingin, minus dus. Ambil sendiri di kos ya.', price: 150000, stock: 1, category: 'Peralatan Kos', latitude: -6.36, longitude: 106.827, locationLabel: 'Kos daerah UI, Depok', imageUrls: ['https://cdn.kosply.test/seed/kipas-cosmos.jpg'] },
  { id: 'seed-product-4', sellerEmail: 'manhattan.cafe@kosply.test', title: 'Rice cooker mini Miyako', description: 'Kapasitas 1.2L, masih normal semua fungsi. Bonus mangkuk kukus.', price: 95000, stock: 1, category: 'Peralatan Kos', latitude: -6.361, longitude: 106.829, locationLabel: 'Stasiun UI, Depok', imageUrls: ['https://cdn.kosply.test/seed/rice-cooker.jpg'] },
  { id: 'seed-product-5', sellerEmail: 'bima.aryo@kosply.test', title: 'Sepeda lipat Element', description: 'Kondisi 90%, baru ganti ban belakang. Sudah laku bulan ini.', price: 1250000, stock: 0, category: 'Olahraga', latitude: -6.914, longitude: 107.609, locationLabel: 'Dipatiukur, Bandung', status: 'SOLD', soldAt: ago({ days: 5 }), imageUrls: ['https://cdn.kosply.test/seed/sepeda-lipat.jpg'] },
  { id: 'seed-product-6', sellerEmail: 'bima.aryo@kosply.test', title: 'iPhone XR 64GB ex-iCloud', description: 'Barang original, mulus, garansi pribadi 7 hari.', price: 3800000, stock: 1, category: 'Elektronik', latitude: -6.916, longitude: 107.611, locationLabel: 'Dago, Bandung', status: 'ARCHIVED', imageUrls: ['https://cdn.kosply.test/seed/iphone-xr.jpg'] },
  { id: 'seed-product-7', sellerEmail: 'alisa.kujou@kosply.test', title: 'Jas lab kimia ukuran M', description: 'Dipakai satu semester, tidak ada noda. Warna putih masih rapi.', price: 60000, stock: 3, category: 'Peralatan Kos', latitude: -7.265, longitude: 112.749, locationLabel: 'Kampus ITS, Surabaya', imageUrls: ['https://cdn.kosply.test/seed/jas-lab.jpg'] },
];

/**
 * @notice KTM applications in every review state.
 * @dev `updatedAt` ordering drives the admin queue (resubmissions jump to the
 * @dev top), so the PENDING rows are the newest.
 */
const VERIFICATIONS = [
  { userEmail: 'alisa.kujou@kosply.test', namaLengkap: 'Alisa Mikhailovna Kujou', nim: '162112133001', universitas: 'Universitas Airlangga', programStudi: 'Teknologi Informasi', ktmImageUrl: 'https://cdn.kosply.test/seed/ktm-alisa.jpg', status: 'APPROVED', isActive: true, action: 'APPROVE', actionNote: 'KTM valid, NIM terdaftar.', reviewedAt: ago({ days: 21 }), updatedAt: ago({ days: 21 }) },
  { userEmail: 'manhattan.cafe@kosply.test', namaLengkap: 'Manhattan Cafe', nim: '204112200452', universitas: 'Universitas Indonesia', programStudi: 'Kedokteran Hewan', ktmImageUrl: 'https://cdn.kosply.test/seed/ktm-manhattan.jpg', status: 'APPROVED', isActive: true, action: 'APPROVE', actionNote: 'Data cocok dengan SIAK.', reviewedAt: ago({ days: 14 }), updatedAt: ago({ days: 14 }) },
  { userEmail: 'bima.aryo@kosply.test', namaLengkap: 'Bima Aryo', nim: '264110180033', universitas: 'Universitas Padjadjaran', programStudi: 'Farmasi', ktmImageUrl: 'https://cdn.kosply.test/seed/ktm-bima.jpg', status: 'APPROVED', isActive: false, action: 'APPROVE', actionNote: 'Disetujui; dibekukan setelah laporan penipuan RPT-SEED-008.', reviewedAt: ago({ days: 25 }), updatedAt: ago({ days: 2 }) },
  { userEmail: 'raka.pratama@kosply.test', namaLengkap: 'Raka Pratama', nim: '132210450088', universitas: 'Institut Teknologi Bandung', programStudi: 'Teknik Elektro', ktmImageUrl: 'https://cdn.kosply.test/seed/ktm-raka.jpg', status: 'PENDING', action: 'NONE', updatedAt: ago({ hours: 3 }) },
  { userEmail: 'intan.permata@kosply.test', namaLengkap: 'Intan Permata', nim: '230411600121', universitas: 'Universitas Negeri Malang', programStudi: 'Pendidikan Bahasa Inggris', ktmImageUrl: 'https://cdn.kosply.test/seed/ktm-intan.jpg', status: 'PENDING', action: 'NONE', updatedAt: ago({ hours: 9 }) },
  { userEmail: 'dimas.saputra@kosply.test', namaLengkap: 'Dimas Saputra', nim: '120301171044', universitas: 'Universitas Diponegoro', programStudi: 'Akuntansi', ktmImageUrl: 'https://cdn.kosply.test/seed/ktm-dimas.jpg', status: 'PENDING', action: 'NONE', updatedAt: ago({ days: 1, hours: 6 }) },
  { userEmail: 'clara.wijaya@kosply.test', namaLengkap: 'Clara Wijaya', nim: '244001330099', universitas: 'Universitas Bina Nusantara', programStudi: 'Desain Komunikasi Visual', ktmImageUrl: 'https://cdn.kosply.test/seed/ktm-clara.jpg', status: 'REJECTED', isActive: false, action: 'REJECT', rejectionReason: 'Foto KTM tidak terbaca (blur) — silakan unggah ulang.', actionNote: 'Menunggu unggah ulang.', reviewedAt: ago({ days: 3 }), updatedAt: ago({ days: 3 }) },
];

/**
 * @notice Fraud reports across all four states.
 * @dev `reportNo` is the idempotency key. PENDING rows are the newest so the
 * @dev dashboard escalation queue leads with fresh cases.
 */
const REPORTS = [
  { reportNo: 'RPT-SEED-001', reporterEmail: 'sinta.dewi@kosply.test', reportedUserEmail: 'raka.pratama@kosply.test', category: 'PENIPUAN', description: 'Minta DP 200rb buat "booking" barang, setelah transfer nomor tidak aktif.', evidenceUrls: ['https://cdn.kosply.test/seed/bukti-001-transfer.jpg', 'https://cdn.kosply.test/seed/bukti-001-chat.jpg'], status: 'PENDING', createdAt: ago({ hours: 4 }), updatedAt: ago({ hours: 4 }) },
  { reportNo: 'RPT-SEED-002', reporterEmail: 'nadia.putri@kosply.test', reportedProductId: 'seed-product-3', category: 'BARANG_TIDAK_SESUAI', description: 'Kipas yang dikirim lecet parah dan baling-baling goyang, tidak seperti di foto.', evidenceUrls: ['https://cdn.kosply.test/seed/bukti-002-unboxing.jpg'], status: 'PENDING', createdAt: ago({ hours: 7 }), updatedAt: ago({ hours: 7 }) },
  { reportNo: 'RPT-SEED-003', reporterEmail: 'yusuf.maulana@kosply.test', reportedProductId: 'seed-product-1', category: 'HARGA_MENYESATKAN', description: 'Harga di deskripsi 2.6jt tapi saat chat diminta tambahan 400rb "biaya pengecekan".', evidenceUrls: [], status: 'PENDING', createdAt: ago({ days: 1, hours: 2 }), updatedAt: ago({ days: 1, hours: 2 }) },
  { reportNo: 'RPT-SEED-004', reporterEmail: 'arima.kousei@kosply.test', reportedUserEmail: 'manhattan.cafe@kosply.test', category: 'SPAM', description: 'Flooding chat: produk yang sama di-bump puluhan kali dengan template identik.', evidenceUrls: ['https://cdn.kosply.test/seed/bukti-004-screenshot.png'], status: 'PENDING', createdAt: ago({ days: 2 }), updatedAt: ago({ days: 2 }) },
  { reportNo: 'RPT-SEED-005', reporterEmail: 'sinta.dewi@kosply.test', reportedProductId: 'seed-product-7', category: 'KONTEN_TIDAK_PANTAS', description: 'Foto produk memuat tulisan kasar yang tidak pantas.', evidenceUrls: [], status: 'IN_REVIEW', createdAt: ago({ days: 4 }), updatedAt: ago({ days: 1 }) },
  { reportNo: 'RPT-SEED-006', reporterEmail: 'alisa.kujou@kosply.test', reportedUserEmail: 'dimas.saputra@kosply.test', category: 'PENIPUAN', description: 'Mengaku mahasiswa tapi NIM dan kampusnya tidak ditemukan saat dicek.', evidenceUrls: ['https://cdn.kosply.test/seed/bukti-006-nim.png'], status: 'IN_REVIEW', createdAt: ago({ days: 6 }), updatedAt: ago({ days: 2 }) },
  { reportNo: 'RPT-SEED-007', reporterEmail: 'nadia.putri@kosply.test', reportedProductId: 'seed-product-6', category: 'BARANG_PALSU', description: 'iPhone yang dijual ternyata unit refurbish pasar, bukan ex-iCloud mulus seperti klaim.', evidenceUrls: ['https://cdn.kosply.test/seed/bukti-007-imei.jpg'], status: 'RESOLVED', action: 'DELETE_PRODUCT', actionNote: 'Terbukti refurbish tidak sesuai deskripsi — listing diarsipkan.', reviewedAt: ago({ days: 5 }), createdAt: ago({ days: 10 }), updatedAt: ago({ days: 5 }) },
  { reportNo: 'RPT-SEED-008', reporterEmail: 'yusuf.maulana@kosply.test', reportedUserEmail: 'bima.aryo@kosply.test', category: 'PENIPUAN', description: 'Setelah pembayaran DP sepeda lipat, penjual menghilang dan memblokir korban.', evidenceUrls: ['https://cdn.kosply.test/seed/bukti-008-chat.jpg', 'https://cdn.kosply.test/seed/bukti-008-transfer.jpg'], status: 'RESOLVED', action: 'BAN_USER', actionNote: 'Pola penipuan DP berulang — akun dibekukan dan lapak dinonaktifkan.', reviewedAt: ago({ days: 2 }), createdAt: ago({ days: 8 }), updatedAt: ago({ days: 2 }) },
  { reportNo: 'RPT-SEED-009', reporterEmail: 'clara.wijaya@kosply.test', reportedUserEmail: 'yusuf.maulana@kosply.test', category: 'LAINNYA', description: 'Pengguna minta tukar nomor pribadi berulang walau sudah ditolak.', evidenceUrls: [], status: 'RESOLVED', action: 'WARNING', actionNote: 'Peringatan pertama, tidak ada pelanggaran lanjutan.', reviewedAt: ago({ days: 6 }), createdAt: ago({ days: 12 }), updatedAt: ago({ days: 6 }) },
  { reportNo: 'RPT-SEED-010', reporterEmail: 'arima.kousei@kosply.test', reportedProductId: 'seed-product-4', category: 'SPAM', description: 'Dikira spam karena diposting ulang, ternyata memang stok baru.', evidenceUrls: [], status: 'REJECTED', action: 'NONE', actionNote: 'Tidak terbukti — penjual menambah stok, bukan duplikasi.', reviewedAt: ago({ days: 9 }), createdAt: ago({ days: 13 }), updatedAt: ago({ days: 9 }) },
];

/**
 * @notice Support tickets with their thread.
 * @dev `sender: 'user'` replies as the reporter; `'admin'` replies as the seeded
 * @dev operator (`senderId` = users row); `'dashboard'` mimics a reply sent from
 * @dev the dashboard session, which has NO `users` row — exactly the null
 * @dev `senderId` + `senderName` shape `support.service.reply` writes.
 */
const TICKETS = [
  {
    ticketNo: 'KSP-SEED-001', userEmail: 'arima.kousei@kosply.test', category: 'AKUN', status: 'ACTIVE',
    subject: 'Tidak bisa login setelah ganti HP', description: 'Sejak ganti HP, login selalu gagal walau password benar. Sudah coba reset password.',
    createdAt: ago({ hours: 5 }), updatedAt: ago({ hours: 2 }), lastMessageAt: ago({ hours: 2 }),
    messages: [
      { id: 'seed-ksp001-m1', sender: 'user', text: 'Halo, saya tidak bisa login sejak ganti HP. Password benar tapi selalu ditolak.', createdAt: ago({ hours: 5 }) },
      { id: 'seed-ksp001-m2', sender: 'admin', text: 'Halo Arima, coba login sekali lagi ya — sesi lama di HP lama sudah kami putus. Kalau masih gagal, kirim screenshot pesan error-nya.', createdAt: ago({ hours: 3 }), isRead: true },
      { id: 'seed-ksp001-m3', sender: 'dashboard', text: 'Catatan: akun aktif, tidak ada percobaan login gagal >5x dari IP berbeda.', createdAt: ago({ hours: 2 }), isInternal: true },
    ],
  },
  {
    ticketNo: 'KSP-SEED-002', userEmail: 'nadia.putri@kosply.test', category: 'LAPORAN', status: 'ACTIVE',
    subject: 'Penjual minta transfer di luar COD', description: 'Penjual menolak COD dan memaksa transfer DP sebelum ketemuan.',
    createdAt: ago({ hours: 8 }), updatedAt: ago({ hours: 4 }), lastMessageAt: ago({ hours: 4 }),
    messages: [
      { id: 'seed-ksp002-m1', sender: 'user', text: 'Mohon dicek ya, penjualnya maksa transfer dulu padahal aturan kampus COD ketemuan.', createdAt: ago({ hours: 8 }) },
      { id: 'seed-ksp002-m2', sender: 'admin', text: 'Terima kasih laporannya. Tolong lampirkan screenshot chat-nya supaya bisa kami tindak lanjuti ke tim moderasi.', createdAt: ago({ hours: 4 }), isRead: true },
    ],
  },
  {
    ticketNo: 'KSP-SEED-003', userEmail: 'clara.wijaya@kosply.test', category: 'VERIFIKASI', status: 'ACTIVE',
    subject: 'KTM saya ditolak padahal jelas', description: 'Pengajuan verifikasi ditolak dengan alasan foto blur, padahal foto saya tajam.',
    createdAt: ago({ days: 1, hours: 3 }), updatedAt: ago({ hours: 6 }), lastMessageAt: ago({ hours: 6 }),
    messages: [
      { id: 'seed-ksp003-m1', sender: 'user', text: 'Kenapa ditolak? Foto KTM saya kemarin jelas banget.', createdAt: ago({ days: 1, hours: 3 }) },
      { id: 'seed-ksp003-m2', sender: 'admin', text: 'Maaf atas ketidaknyamanannya. Coba unggah ulang dengan pencahayaan lebih terang ya, lalu ajukan lagi.', createdAt: ago({ hours: 10 }), isRead: true },
      { id: 'seed-ksp003-m3', sender: 'user', text: 'Oke, nanti saya unggah ulang.', createdAt: ago({ hours: 6 }), isRead: true },
    ],
  },
  {
    ticketNo: 'KSP-SEED-004', userEmail: 'yusuf.maulana@kosply.test', category: 'CHAT', status: 'ACTIVE',
    subject: 'Chat ke penjual tidak terkirim', description: 'Pesan chat stuck di status "mengirim" sejak tadi pagi.',
    createdAt: ago({ hours: 2 }), updatedAt: ago({ hours: 1 }), lastMessageAt: ago({ hours: 1 }),
    messages: [
      { id: 'seed-ksp004-m1', sender: 'user', text: 'Ada gangguan chat ya? Pesan saya tidak terkirim ke penjual dari pagi.', createdAt: ago({ hours: 2 }) },
      { id: 'seed-ksp004-m2', sender: 'dashboard', text: 'Dicek: antrean pesan normal, kemungkinan koneksi klien. Minta coba kirim ulang setelah buka aplikasi.', createdAt: ago({ hours: 1 }), isInternal: true },
    ],
  },
  {
    ticketNo: 'KSP-SEED-005', userEmail: 'sinta.dewi@kosply.test', category: 'PRODUK', status: 'CLOSED',
    subject: 'Barang tidak sesuai deskripsi', description: 'Jas lab yang datang ukurannya S, padahal deskripsi tertulis M.',
    createdAt: ago({ days: 7 }), updatedAt: ago({ hours: 20 }), lastMessageAt: ago({ hours: 21 }),
    messages: [
      { id: 'seed-ksp005-m1', sender: 'user', text: 'Ukuran yang dikirim S, deskripsi bilang M. Bagaimana ini?', createdAt: ago({ days: 7 }) },
      { id: 'seed-ksp005-m2', sender: 'admin', text: 'Kami sudah hubungi penjual; stok M akan dikirim ulang tanpa biaya tambahan.', createdAt: ago({ days: 6 }), isRead: true },
      { id: 'seed-ksp005-m3', sender: 'user', text: 'Barang pengganti sudah sampai, terima kasih!', createdAt: ago({ hours: 21 }), isRead: true },
      { id: 'seed-ksp005-m4', sender: 'admin', text: 'Siap, tiket kami tutup ya. Kalau ada kendala lain silakan buka tiket baru.', createdAt: ago({ hours: 20 }), isRead: true },
    ],
  },
  {
    ticketNo: 'KSP-SEED-006', userEmail: 'arima.kousei@kosply.test', category: 'AKUN', status: 'CLOSED',
    subject: 'Lupa password', description: 'Kode OTP tidak pernah masuk ke email kampus.',
    createdAt: ago({ days: 9 }), updatedAt: ago({ days: 8, hours: 22 }), lastMessageAt: ago({ days: 8, hours: 22 }),
    messages: [
      { id: 'seed-ksp006-m1', sender: 'user', text: 'OTP reset password tidak masuk ke email saya.', createdAt: ago({ days: 9 }) },
      { id: 'seed-ksp006-m2', sender: 'admin', text: 'Cek folder spam/portal email kampus, lalu minta ulang kode. Jika tetap kosong hubungi kami lagi.', createdAt: ago({ days: 8, hours: 23 }), isRead: true },
      { id: 'seed-ksp006-m3', sender: 'user', text: 'Ternyata masuk folder spam. Sudah bisa. Terima kasih.', createdAt: ago({ days: 8, hours: 22 }), isRead: true },
    ],
  },
  {
    ticketNo: 'KSP-SEED-007', userEmail: 'raka.pratama@kosply.test', category: 'VERIFIKASI', status: 'CLOSED',
    subject: 'Cara upload KTM yang benar?', description: 'Bingung apakah foto KTM perlu dilihat bersama KIR kartu?',
    createdAt: ago({ days: 11 }), updatedAt: ago({ days: 10, hours: 20 }), lastMessageAt: ago({ days: 10, hours: 20 }),
    messages: [
      { id: 'seed-ksp007-m1', sender: 'user', text: 'Foto KTM perlu sambil pegang KIR kah?', createdAt: ago({ days: 11 }) },
      { id: 'seed-ksp007-m2', sender: 'admin', text: 'Tidak perlu. Cukup foto KTM asli, pencahayaan terang, seluruh kartu terlihat jelas.', createdAt: ago({ days: 10, hours: 21 }), isRead: true },
      { id: 'seed-ksp007-m3', sender: 'user', text: 'Baik, nanti saya upload ulang.', createdAt: ago({ days: 10, hours: 20 }), isRead: true },
    ],
  },
  {
    ticketNo: 'KSP-SEED-008', userEmail: 'manhattan.cafe@kosply.test', category: 'LAINNYA', status: 'CLOSED',
    subject: 'Saran: filter pencarian berdasarkan lokasi kampus', description: 'Sulit cari barang di kampus sendiri, pengin filter radius.',
    createdAt: ago({ days: 14 }), updatedAt: ago({ days: 13 }), lastMessageAt: ago({ days: 13 }),
    messages: [
      { id: 'seed-ksp008-m1', sender: 'user', text: 'Bisa ditambah filter "sekitar kampus saya"?', createdAt: ago({ days: 14 }) },
      { id: 'seed-ksp008-m2', sender: 'admin', text: 'Saran bagus! Sudah kami catat untuk roadmap. Terima kasih!', createdAt: ago({ days: 13, hours: 12 }), isRead: true },
    ],
  },
];

/** @notice AI model registry — pricing spread + one disabled row. */
const MODELS = [
  { modelId: 'muse-spark-1.3', name: 'Muse Spark 1.3', inputPrice: 0.15, outputPrice: 0.15, cacheReadPrice: 0.016, isActive: true },
  { modelId: 'glm-5.3-flashx', name: 'GLM-5.3 FlashX', inputPrice: 0.15, outputPrice: 0.47, cacheReadPrice: 0.016, isActive: true },
  { modelId: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', inputPrice: 0.15, outputPrice: 0.15, cacheReadPrice: 0.15, isActive: true },
  { modelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', inputPrice: 0.15, outputPrice: 0.15, cacheReadPrice: 0.15, isActive: true },
  { modelId: 'qwen-3.5-max', name: 'Qwen 3.5 Max', inputPrice: 1.2, outputPrice: 4.8, cacheReadPrice: 0.3, isActive: true },
  { modelId: 'llama-4-scout', name: 'Llama 4 Scout', inputPrice: 0.1, outputPrice: 0.25, cacheReadPrice: 0, isActive: false },
];

/**
 * @notice Tool-invocation mix for the benchmark surface.
 * @dev Counts are deliberately unequal (a real ranking), `failEvery` sprinkles
 * @dev failures/TIMEOUTs through each tool, and `latency` is a [min, max] band
 * @dev the generator walks deterministically.
 */
const TOOL_PLAN = [
  { tool: 'search_products', count: 46, failEvery: 15, latency: [220, 640] },
  { tool: 'compare_items', count: 27, failEvery: 13, latency: [380, 900] },
  { tool: 'get_product_detail', count: 19, failEvery: 0, latency: [120, 300] },
  { tool: 'add_to_cart', count: 14, failEvery: 14, latency: [260, 520] },
  { tool: 'send_chat_message', count: 9, failEvery: 9, latency: [300, 640] },
  { tool: 'request_seller_contact', count: 5, failEvery: 5, latency: [500, 1200] },
];

/**
 * @notice Timestamp for the n-th generated invocation.
 * @dev Day offsets stay >= 1 so no fixture lands in the future, and the hour
 * @dev cycle is weighted towards 19:00-22:00 WIB — the same peak the dashboard
 * @dev card advertises — by converting the intended local hour back to UTC.
 * @param {number} index Zero-based invocation index.
 * @returns {Date} Deterministic creation time inside the last 28 days.
 */
const invocationTime = (index) => {
  /** @dev Local (WIB) hour cycle: evening hours repeat, office hours fill in. */
  const localHours = [19, 20, 21, 22, 19, 20, 21, 13, 10, 15, 20, 21];
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (1 + (index % 28)));
  date.setUTCHours((localHours[index % localHours.length] - 7 + 24) % 24, (index * 7) % 60, 0, 0);
  return date;
};

/**
 * @notice Build the raw tool-invocation rows (no DB access).
 * @dev Regenerated from the plan on every run and inserted as a set, so the
 * @dev table always matches the plan exactly instead of accumulating stale rows.
 * @param {Record<string, string>} userIds email → user id map from the user pass.
 * @returns {object[]} Rows ready for `prisma.toolInvocation.createMany`.
 */
const buildToolInvocations = (userIds) => {
  const callerIds = Object.values(userIds);
  const modelIds = MODELS.map((model) => model.modelId);
  const rows = [];
  let index = 0;

  for (const plan of TOOL_PLAN) {
    for (let i = 0; i < plan.count; i += 1) {
      const isFailure = plan.failEvery > 0 && i > 0 && i % plan.failEvery === 0;
      rows.push({
        id: `seed-tool-${String(index + 1).padStart(4, '0')}`,
        tool: plan.tool,
        model: modelIds[index % modelIds.length],
        userId: index % 5 === 0 ? null : callerIds[index % callerIds.length],
        status: isFailure ? (i % (plan.failEvery * 2) === 0 ? 'FAILED' : 'TIMEOUT') : 'SUCCESS',
        latencyMs: plan.latency[0] + ((index * 37) % (plan.latency[1] - plan.latency[0])),
        createdAt: invocationTime(index),
      });
      index += 1;
    }
  }

  return rows;
};

/**
 * @notice Write every dashboard fixture.
 * @param {import('@prisma/client').PrismaClient} prisma Prisma client singleton.
 * @param {{ adminUserId: string }} context Ids from `accounts.js` used for audit fields.
 * @returns {Promise<Record<string, number>>} Row counts per surface, for the run report.
 */
const seedDashboard = async (prisma, context) => {
  /** @type {Record<string, string>} email → user id */
  const userIds = {};

  for (const user of USERS) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, isActive: user.isActive ?? true, bio: user.bio ?? null },
      create: {
        email: user.email,
        username: user.username,
        name: user.name,
        passwordHash: markerHash(user.email),
        universitas: user.universitas,
        programStudi: user.programStudi,
        role: user.role,
        bio: user.bio ?? null,
        isActive: user.isActive ?? true,
      },
      select: { id: true },
    });
    userIds[user.email] = record.id;
  }

  for (const product of PRODUCTS) {
    const { id, sellerEmail, ...fields } = product;
    const data = { ...fields, sellerId: userIds[sellerEmail] };
    await prisma.product.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  }

  for (const verification of VERIFICATIONS) {
    const { userEmail, reviewedAt, updatedAt, ...fields } = verification;
    const userId = userIds[userEmail];
    const data = {
      ...fields,
      userId,
      reviewedAt: reviewedAt ?? null,
      reviewedBy: reviewedAt ? context.adminUserId : null,
    };
    await prisma.sellerVerification.upsert({
      where: { userId },
      update: { ...data, updatedAt: updatedAt ?? new Date() },
      create: { ...data, ...(updatedAt && { updatedAt }) },
    });
  }

  for (const report of REPORTS) {
    const { reporterEmail, reportedUserEmail, createdAt, updatedAt, ...fields } = report;
    const data = {
      ...fields,
      reporterId: userIds[reporterEmail],
      reportedUserId: reportedUserEmail ? userIds[reportedUserEmail] : null,
      reviewedBy: fields.reviewedAt ? context.adminUserId : null,
    };
    await prisma.report.upsert({
      where: { reportNo: report.reportNo },
      update: { ...data, createdAt, updatedAt },
      create: { ...data, createdAt, updatedAt },
    });
  }

  for (const ticket of TICKETS) {
    const { userEmail, messages, ...fields } = ticket;
    const userId = userIds[userEmail];
    const ticketData = { ...fields, userId };
    await prisma.supportTicket.upsert({
      where: { ticketNo: ticket.ticketNo },
      update: ticketData,
      create: ticketData,
    });
    const ticketRow = await prisma.supportTicket.findUnique({
      where: { ticketNo: ticket.ticketNo },
      select: { id: true },
    });

    for (const message of messages) {
      const isUser = message.sender === 'user';
      const isDashboard = message.sender === 'dashboard';
      const messageData = {
        ticketId: ticketRow.id,
        senderId: isDashboard ? null : isUser ? userId : context.adminUserId,
        senderRole: isUser ? 'BUYER' : 'SUPER_ADMIN',
        senderName: isDashboard ? 'Ops Kosply (dashboard)' : null,
        text: message.text,
        isInternal: message.isInternal ?? false,
        isRead: message.isRead ?? false,
        createdAt: message.createdAt,
      };
      await prisma.supportMessage.upsert({
        where: { id: message.id },
        update: messageData,
        create: { id: message.id, ...messageData },
      });
    }
  }

  for (const model of MODELS) {
    await prisma.aiModel.upsert({
      where: { modelId: model.modelId },
      update: model,
      create: model,
    });
  }

  // Tool invocations are a log, not a mutable entity: the plan is regenerated
  // and re-inserted as a set, so the table always matches TOOL_PLAN instead of
  // accumulating stale rows from an earlier plan.
  await prisma.toolInvocation.deleteMany({ where: { id: { startsWith: 'seed-tool-' } } });
  const toolInvocations = buildToolInvocations(userIds);
  await prisma.toolInvocation.createMany({ data: toolInvocations });

  return {
    users: USERS.length,
    products: PRODUCTS.length,
    verifications: VERIFICATIONS.length,
    reports: REPORTS.length,
    tickets: TICKETS.length,
    ticketMessages: TICKETS.reduce((total, ticket) => total + ticket.messages.length, 0),
    models: MODELS.length,
    toolInvocations: toolInvocations.length,
  };
};

module.exports = { seedDashboard };
