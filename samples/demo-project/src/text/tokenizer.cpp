#include <regex>
#include <string>
#include <vector>

namespace text {
std::vector<std::string> tokens(const std::string& s) {
  std::regex re("\\w+");
  std::vector<std::string> out;
  for (std::sregex_iterator it(s.begin(), s.end(), re), end; it != end; ++it) out.push_back(it->str());
  return out;
}
}  // namespace text
