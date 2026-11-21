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

template <std::size_t... I>
constexpr long long sum_fib(std::index_sequence<I...>) {
  return (Fib<static_cast<int>(I % 60)>::value + ...);
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
