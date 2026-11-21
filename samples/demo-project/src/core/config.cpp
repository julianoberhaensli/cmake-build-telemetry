#include <map>
#include <string>

namespace core {
std::map<std::string, std::string>& config() {
  static std::map<std::string, std::string> c;
  return c;
}
}  // namespace core
