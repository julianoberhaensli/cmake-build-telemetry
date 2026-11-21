#include <iostream>
#include <vector>

namespace numeric {
double mean(const std::vector<double>&);
double stddev(const std::vector<double>&);
double trace16();
}  // namespace numeric

int main() {
  const std::vector<double> v{1, 2, 3, 4};
  std::cout << numeric::mean(v) << " " << numeric::stddev(v) << " " << numeric::trace16() << "\n";
  return 0;
}
