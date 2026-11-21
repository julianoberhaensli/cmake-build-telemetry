#include <array>
#include <cstddef>

namespace numeric {
template <std::size_t N>
struct Mat {
  std::array<double, N * N> v{};
};

template <std::size_t N>
Mat<N> mul(const Mat<N>& a, const Mat<N>& b) {
  Mat<N> r;
  for (std::size_t i = 0; i < N; ++i)
    for (std::size_t j = 0; j < N; ++j)
      for (std::size_t k = 0; k < N; ++k) r.v[i * N + j] += a.v[i * N + k] * b.v[k * N + j];
  return r;
}

double trace16() {
  Mat<16> a;
  for (std::size_t i = 0; i < 16; ++i) a.v[i * 16 + i] = 1;
  auto r = mul(a, a);
  double t = 0;
  for (std::size_t i = 0; i < 16; ++i) t += r.v[i * 16 + i];
  return t;
}
}  // namespace numeric
