// Template-heavy translation unit: intentionally slow to compile.
#include <cstddef>
#include <tuple>
#include <type_traits>
#include <utility>

namespace numeric {
template <int N>
struct Fib {
  static constexpr long long value = Fib<N - 1>::value + Fib<N - 2>::value;
};
template <>
struct Fib<1> {
  static constexpr long long value = 1;
};
template <>
struct Fib<0> {
  static constexpr long long value = 0;
};

// Pack expansion into an array, not a fold expression: Clang limits fold expressions
// to its bracket depth (256 by default), and this sums 900 terms.
template <std::size_t... I>
constexpr long long sum_fib(std::index_sequence<I...>) {
  constexpr long long values[] = {Fib<static_cast<int>(I % 60)>::value...};
  long long sum = 0;
  for (long long v : values) sum += v;
  return sum;
}

template <std::size_t N>
struct Deep {
  using type = std::tuple<typename Deep<N - 1>::type, std::integral_constant<std::size_t, N>>;
};
template <>
struct Deep<0> {
  using type = std::tuple<>;
};

long long meta_value() {
  typename Deep<48>::type t{};
  (void)t;
  return sum_fib(std::make_index_sequence<900>{});
}
}  // namespace numeric
