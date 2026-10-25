# Asal source, gambar, dan data

Proyek ini melanjutkan latihan `project_sem4` dari koleksi kerja pemilik repository. Fitur awal yang dipertahankan adalah pencarian bahan TheMealDB, daftar kategori, halaman kategori, dan modal detail resep dengan tautan video.

`bg.jpeg` dan `icon.png` disalin tanpa perubahan byte dari source awal. Gambar dan berkas lain yang tidak digunakan tetap berada dalam cadangan source asli. Tidak ada gambar, logo, testimoni, atau resep baru yang dibuat untuk halaman aplikasi.

Perapihan menghapus ketergantungan runtime pada CDN Bootstrap/ikon dan menggunakan JavaScript ES modules. Konten placeholder slider/review tidak dipertahankan sebagai klaim pengguna nyata. Kategori tetap pada kode diganti dengan pilihan dari URL/formulir, dan respons API ditangani dengan validasi serta pemulihan kesalahan.

Nama, gambar hasil, bahan, takaran, dan petunjuk berasal dari TheMealDB serta sumber resep yang ditautkan di dalam responsnya. Screenshot README berasal dari respons API langsung, bukan fixture tes. Fixture adversarial yang berlabel contoh hanya digunakan oleh pengujian browser.

[Dokumentasi API dan penggunaan key](https://www.themealdb.com/api.php) serta ketentuan penyedia berlaku untuk data eksternal. Tidak ada lisensi baru yang ditetapkan untuk aset lama yang lisensinya tidak tercatat dalam source. Dependency pengujian Playwright mempertahankan lisensi upstream-nya.
