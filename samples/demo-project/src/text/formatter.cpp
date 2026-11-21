#include <iomanip>
#include <sstream>
#include <string>

namespace text {
std::string fmt(double v, int precision) {
  std::ostringstream o;
  o << std::fixed << std::setprecision(precision) << v;
  return o.str();
}
}  // namespace text
