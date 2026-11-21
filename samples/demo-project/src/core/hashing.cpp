#include <cstdint>
#include <string>

namespace core {
std::uint64_t fnv1a(const std::string& s) {
  std::uint64_t h = 1469598103934665603ull;
  for (unsigned char c : s) {
    h ^= c;
    h *= 1099511628211ull;
  }
  return h;
}
}  // namespace core
